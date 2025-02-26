#!/bin/bash

##### MUST EDIT THE VALUES BELOW #####
project_id=<your_project_id_goes_here>
d9_id=<your_d9_api_id_goes_here>
d9_secret=<your_d9_api_secret_goes_here>
psk=<your_psk_goes_here>
base_url=
EXCLUDE_PROJECTS=
INCLUDE_PROJECTS=
##### MUST EDIT THE VALUES ABOVE #####

##### NO NEED TO EDIT THE VALUES BELOW #####
sa_id=d9-autobrd
secrets_d9_id=d9_autobrd_d9_id
secrets_d9_secret=d9_autobrd_d9_secret
secrets_psk=d9_autobrd_psk
##### NO NEED TO EDIT THE VALUES ABOVE #####

# Roles
IAM_ROLE="roles/resourcemanager.projectIamAdmin"
SERVICE_ACCOUNT_ROLE="roles/iam.serviceAccountAdmin"
SERVICE_ACCOUNT_KEY_ROLE="roles/iam.serviceAccountKeyAdmin"
SERVICE_USAGE_ROLE="roles/serviceusage.serviceUsageAdmin"

PROJECT_ROLES_LIST=(
  $IAM_ROLE
  $SERVICE_ACCOUNT_ROLE
  $SERVICE_ACCOUNT_KEY_ROLE
  $SERVICE_USAGE_ROLE
)

cat << EOF > d9_id.txt
$d9_id
EOF

cat << EOF > d9_secret.txt
$d9_secret
EOF

cat << EOF > psk.txt
$psk
EOF

cat << EOF > runtime.env.yaml
D9_BASE_URL: "${base_url:-https://api.dome9.com/v2}"
GCP_PROJECT_LIST_LIMIT: "100"
EXCLUDE_PROJECTS: "$EXCLUDE_PROJECTS"
INCLUDE_PROJECTS: "$INCLUDE_PROJECTS"
EOF

cat << EOF > .gcloudignore
.gcloudignore
.git
.gitignore

gcloud.sh
gcloud-with-secrets.sh
examples
LICENSE
node_modules
package-lock.json
README.md
runtime.env.yaml
EOF

echo "Enabling cloudbuild.googleapis.com"
gcloud services enable cloudbuild.googleapis.com --project=$project_id
echo "Enabling cloudfunctions.googleapis.com"
gcloud services enable iam.googleapis.com --project=$project_id
echo "Enabling cloudresourcemanager.googleapis.com"
gcloud services enable cloudresourcemanager.googleapis.com --project=$project_id
echo "Enabling serviceusage.googleapis.com"
gcloud services enable serviceusage.googleapis.com --project=$project_id
echo "Enabling secretmanager.googleapis.com"
gcloud services enable secretmanager.googleapis.com --project=$project_id

error_message=$(gcloud iam service-accounts create $sa_id \
  --project=$project_id \
  --description="The service account for the d9-autobrd-gcp cloud function" \
  --display-name="D9 Autobrd" 2>&1)

if [[ $error_message == *"already exists"* ]]; then
  echo "Service account '$sa_id' already exists in project '$project_id'."
else
  # If there was some other error or success, you can handle it differently
  if [[ $? -eq 0 ]]; then
    echo "Service account '$sa_id' created successfully in project '$project_id'."
  else
    echo "Failed to create service account '$sa_id' in project '$project_id'. Error: $error_message"
  fi
fi


secrets=("$secrets_d9_id" "$secrets_d9_secret" "$secrets_psk")
files=("d9_id.txt" "d9_secret.txt" "psk.txt")

echo "Creating D9 Autobrd secrets in project '$project_id'..."
echo "Deleting existing D9 Autobrd secrets..."
# Delete secrets
for secret in "${secrets[@]}"; do
  gcloud secrets delete $secret --project=$project_id --quiet > /dev/null 2>&1
done

# Create secrets
for secret in "${secrets[@]}"; do
  gcloud secrets create $secret --project=$project_id
done

# Add versions to secrets
for i in "${!secrets[@]}"; do
  gcloud secrets versions add ${secrets[$i]} --data-file="${files[$i]}" --project=$project_id
done

# Remove files
rm "${files[@]}"

# Add IAM policy bindings
for secret in "${secrets[@]}"; do
  output_message=$(gcloud secrets add-iam-policy-binding $secret \
    --project=$project_id \
    --member="serviceAccount:$sa_id@$project_id.iam.gserviceaccount.com" \
    --role="roles/secretmanager.secretAccessor" 2>&1)

  if [[ $? -eq 0 ]]; then
    echo "Successfully added IAM policy binding for service account '$sa_id' to secret '$secret'."
  else
    echo "Failed to add IAM policy binding for service account '$sa_id' to secret '$secret'. Error: $output_message" >&2
  fi
done

  secrets_rp_d9_id=$(gcloud secrets describe $secrets_d9_id --project=$project_id |grep "name:" |awk '{ print $2 }')
  secrets_rp_d9_secret=$(gcloud secrets describe $secrets_d9_secret --project=$project_id |grep "name:" |awk '{ print $2 }')
  secrets_rp_psk=$(gcloud secrets describe $secrets_psk --project=$project_id |grep "name:" |awk '{ print $2 }')

  echo "Resource paths for new secrets:"
  echo $secrets_rp_d9_id
  echo $secrets_rp_d9_secret
  echo $secrets_rp_psk

# Function to check if a string matches any pattern in a space-separated list
match_patterns() {
    local value="$1"
    local patterns="$2"

    for pattern in $patterns; do
        if [[ "$value" == $pattern ]]; then
            return 0
        fi
    done
    return 1
}

# Get all projects and filter them
filtered_projects=$(gcloud projects list --format="value(projectId)" | while read curr_project_id; do
    # Skip if project matches any exclude pattern
    if [[ -n "$EXCLUDE_PROJECTS" ]] && match_patterns "$curr_project_id" "$EXCLUDE_PROJECTS"; then
        continue
    fi

    # Skip if INCLUDE_PROJECTS is set and project doesn't match any include pattern
    if [[ -n "$INCLUDE_PROJECTS" ]] && ! match_patterns "$curr_project_id" "$INCLUDE_PROJECTS"; then
        continue
    fi

    echo "$curr_project_id"
done)

for binding_project_id in $filtered_projects; do
  echo "Adding roles to project '$binding_project_id' for service account '$sa_id'..."
  for role in "${PROJECT_ROLES_LIST[@]}"; do
    output_message=$(gcloud projects add-iam-policy-binding $binding_project_id \
      --member="serviceAccount:$sa_id@$project_id.iam.gserviceaccount.com" \
      --role=$role 2>&1)

    if [[ $? -eq 0 ]]; then
      echo "Project '$binding_project_id' - Successfully added role '$role' for service account '$sa_id'."
    else
      echo "Project '$binding_project_id' - failed to adde role '$role' for service account '$sa_id'. Error: $output_message" >&2
    fi
  done
done

echo "Deploying the cloud function..."
gcloud beta functions deploy d9AutobrdOnboard --project $project_id --trigger-http --runtime nodejs20 --service-account $sa_id@$project_id.iam.gserviceaccount.com --allow-unauthenticated --max-instances 1 --timeout 540 --env-vars-file runtime.env.yaml --set-secrets="D9_ID=$secrets_rp_d9_id:1,D9_SECRET=$secrets_rp_d9_secret:1,PSK=$secrets_rp_psk:1"

exit $?