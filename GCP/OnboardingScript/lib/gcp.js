// Copyright 2021 Dana James Traversie, Check Point Software Technologies, Ltd.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

const {google} = require('googleapis');

const GCP_PROJECT_LIST_LIMIT = process.env.GCP_PROJECT_LIST_LIMIT || 100;

const getAuthClient = async () => {
    const auth = new google.auth.GoogleAuth({
        scopes: [
            'https://www.googleapis.com/auth/cloud-platform',
            'https://www.googleapis.com/auth/service.management'
        ]
    });

    return await auth.getClient();
};

exports.updateProjectIAMPolicy = async (project, serviceAccount) => {
    const member = `serviceAccount:${serviceAccount.email}`;
    const iamPolicy = await this.getProjectIAMPolicy(project.projectId);

    const rolesToAdd = [
        { role: 'roles/viewer', pushed: false },
        { role: 'roles/iam.securityReviewer', pushed: false },
        { role: 'roles/cloudasset.viewer', pushed: false },
        { role: 'roles/serviceusage.serviceUsageConsumer', pushed: false },
    ];

    iamPolicy.bindings.forEach(binding => {
        rolesToAdd.forEach(roleObj => {
            if (binding.role === roleObj.role) {
                if (!binding.members.includes(member)) {
                    binding.members.push(member);
                    roleObj.pushed = true;
                }
            }
        });
    });

    rolesToAdd.forEach(roleObj => {
        if (!roleObj.pushed) {
            iamPolicy.bindings.push({ role: roleObj.role, members: [member] });
        }
    });

    return await this.setProjectIAMPolicy(project.projectId, iamPolicy);
};

exports.getProjectIAMPolicy = async (projectId) => {
    const req = {
        resource: projectId
    };
    var r = await google.cloudresourcemanager('v1').projects.getIamPolicy(req);
    return r ? r.data : {};
};

exports.setProjectIAMPolicy = async (projectId, iamPolicy) => {
    var req = {
        resource: projectId,
        requestBody: {"policy": iamPolicy}
    };
    var r = await google.cloudresourcemanager('v1').projects.setIamPolicy(req);
    return r ? r.data : {};
};

exports.createServiceAccount = async (projectId) => {
    const iam = google.iam('v1');
    const req = {
        name: `projects/${projectId}`,
        requestBody: {
            accountId: 'cloudguard-connect',
            serviceAccount: { displayName: 'CloudGuard-Connect' }
        }
    };
    const response = await iam.projects.serviceAccounts.create(req);
    return response.data;
};

exports.deleteServiceAccountKeys = async (projectId, serviceAccountEmail) => {
    const iam = google.iam('v1');
    const params = { name: `projects/${projectId}/serviceAccounts/${serviceAccountEmail}` };
    const response = await iam.projects.serviceAccounts.keys.list(params);

    const keys = response.data.keys || [];
    const deletePromises = keys
        .filter(key => key.keyType === 'USER_MANAGED')
        .map(key => iam.projects.serviceAccounts.keys.delete({ name: key.name }));

    await Promise.all(deletePromises);
};

exports.createServiceAccountKey = async (projectId, serviceAccountEmail) => {
    const iam = google.iam('v1');
    const params = { name: `projects/${projectId}/serviceAccounts/${serviceAccountEmail}` };
    const response = await iam.projects.serviceAccounts.keys.create(params);
    return response.data;
};

exports.getCloudGuardServiceAccount = async (projectId) => {
    const iam = google.iam('v1');
    const req = { name: `projects/${projectId}`, pageSize: GCP_PROJECT_LIST_LIMIT };
    const response = await iam.projects.serviceAccounts.list(req);
    const serviceAccounts = response.data.accounts || [];

    return serviceAccounts.find(account =>
        account.email.startsWith('cloudguard-connect@') && account.displayName === 'CloudGuard-Connect'
    ) || {};
};

function parsePatterns(patternsStr) {
    if (!patternsStr.trim()) return [];
    return patternsStr.split(/\s+/).filter(Boolean);
}

function wildcardMatch(text, pattern) {
    const regexPattern = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.');
    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(text);
}

function matchesPattern(name, patterns) {
    return patterns.some(pattern => wildcardMatch(name, pattern));
}

exports.listProjects = async () => {
    const excludePatterns = parsePatterns(process.env.EXCLUDE_PROJECTS || '');
    const includePatterns = parsePatterns(process.env.INCLUDE_PROJECTS || '');

    try {
        let projects = [];
        let nextPageToken = '';

        const cloudResourceManager = google.cloudresourcemanager('v1');
        do {
            const params = {
                pageSize: GCP_PROJECT_LIST_LIMIT,
                pageToken: nextPageToken,
            }
            const r = await cloudResourceManager.projects.list(params);
            if (r.data.projects) {
                projects = projects.concat(r.data.projects);
            }
            nextPageToken = r.data.nextPageToken || '';
        } while (nextPageToken);

        return projects.filter(project => {
            const projectName = project.name;
            if (matchesPattern(projectName, excludePatterns)) return false;
            return includePatterns.length === 0 || matchesPattern(projectName, includePatterns);
        });
    } catch (error) {
        console.error("Error fetching project list:", error);
        throw error;
    }
};

exports.enableRequiredAPIServices = async (projectId) => {
    // Get auth client and set quota project
    const authClient = await getAuthClient();
    authClient.quotaProjectId = projectId;

    const serviceUsage = google.serviceusage({
        version: 'v1',
        auth: authClient
    });

    var svcNames = [
        'compute.googleapis.com',
        'cloudresourcemanager.googleapis.com',
        'serviceusage.googleapis.com',
        'iam.googleapis.com',
        'cloudkms.googleapis.com',
        'container.googleapis.com',
        'bigquery-json.googleapis.com',
        'admin.googleapis.com',
        'bigtableadmin.googleapis.com',
        'cloudfunctions.googleapis.com',
        'sqladmin.googleapis.com',
        'redis.googleapis.com',
        'appengine.googleapis.com',
        'file.googleapis.com',
        'accessapproval.googleapis.com',
        'essentialcontacts.googleapis.com',
        'cloudasset.googleapis.com',
        'apikeys.googleapis.com',
        'dns.googleapis.com',
        'logging.googleapis.com',
        'bigquery.googleapis.com',
        'pubsub.googleapis.com',
        'apigeeregistry.googleapis.com',
        'alloydb.googleapis.com',
        'cloudsupport.googleapis.com',
        'discoveryengine.googleapis.com',
        'firebaseappdistribution.googleapis.com',
        'firebasedatabase.googleapis.com',
        'firebasehosting.googleapis.com',
        'firestore.googleapis.com',
        'iap.googleapis.com',
        'identitytoolkit.googleapis.com',
        'networksecurity.googleapis.com',
        'networkservices.googleapis.com',
        'notebooks.googleapis.com',
        'recaptchaenterprise.googleapis.com',
        'retail.googleapis.com',
        'run.googleapis.com',
        'secretmanager.googleapis.com',
        'securitycenter.googleapis.com',
        'sourcerepo.googleapis.com',
        'storagetransfer.googleapis.com',
        'translate.googleapis.com'
    ];
    let promises = svcNames.map(async (svcName) => {
        try {
            await serviceUsage.services.enable({
                name: `projects/${projectId}/services/${svcName}`
            });
            console.log(`Successfully enabled service: ${svcName}`);
        } catch (error) {
            console.error(`Error enabling service: ${svcName}`, error.message);
        }
    });
    await Promise.all(promises);
    return true;
};

exports.initGoogleAuthCredential = async () => {
    const authClient = await getAuthClient();
    // Set global options to use the authenticated client
    google.options({
        auth: authClient
    });
    return authClient;
};