#!/bin/bash

##### MUST EDIT THE VALUES BELOW #####
project_id=yohain1
d9_id=a9da8953-6cd8-4e70-976b-a428b9c66d4d
d9_secret=e9yp9jtu8q9qtuxezrqwc7cp
psk=kcClcCOas/Vh9hYyhCWpIwuivTlsGDRl
base_url=
EXCLUDE_PROJECTS=
INCLUDE_PROJECTS="dormoyal"
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

gcloud services enable cloudbuild.googleapis.com --project=$project_id
gcloud services enable iam.googleapis.com --project=$project_id
gcloud services enable cloudresourcemanager.googleapis.com --project=$project_id
gcloud services enable secretmanager.googleapis.com --project=$project_id

gcloud iam service-accounts create $sa_id --project=$project_id --description="The service account for the d9-autobrd-gcp cloud function" --display-name="D9 Autobrd"

gcloud secrets delete $secrets_d9_id --project=$project_id
gcloud secrets delete $secrets_d9_secret --project=$project_id
gcloud secrets delete $secrets_psk --project=$project_id

gcloud secrets create $secrets_d9_id --project=$project_id
gcloud secrets create $secrets_d9_secret --project=$project_id
gcloud secrets create $secrets_psk --project=$project_id

gcloud secrets versions add $secrets_d9_id --data-file="d9_id.txt" --project=$project_id
gcloud secrets versions add $secrets_d9_secret --data-file="d9_secret.txt" --project=$project_id
gcloud secrets versions add $secrets_psk --data-file="psk.txt" --project=$project_id

rm d9_id.txt d9_secret.txt psk.txt

gcloud secrets add-iam-policy-binding $secrets_d9_id --project=$project_id --member="serviceAccount:$sa_id@$project_id.iam.gserviceaccount.com" --role="roles/secretmanager.secretAccessor"
gcloud secrets add-iam-policy-binding $secrets_d9_secret --project=$project_id --member="serviceAccount:$sa_id@$project_id.iam.gserviceaccount.com" --role="roles/secretmanager.secretAccessor"
gcloud secrets add-iam-policy-binding $secrets_psk --project=$project_id --member="serviceAccount:$sa_id@$project_id.iam.gserviceaccount.com" --role="roles/secretmanager.secretAccessor"

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

for role in ${PROJECT_ROLES_LIST[@]}; do
  for binding_project_id in $filtered_projects; do
    gcloud projects add-iam-policy-binding $binding_project_id --member="serviceAccount:$sa_id@$project_id.iam.gserviceaccount.com" --role=$role
  done
done

gcloud beta functions deploy d9AutobrdOnboard --project $project_id --trigger-http --runtime nodejs20 --service-account $sa_id@$project_id.iam.gserviceaccount.com --allow-unauthenticated --max-instances 1 --timeout 540 --env-vars-file runtime.env.yaml --set-secrets="D9_ID=$secrets_rp_d9_id:1,D9_SECRET=$secrets_rp_d9_secret:1,PSK=$secrets_rp_psk:1"

exit $?