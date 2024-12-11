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

const { google } = require('googleapis');
const Q = require('q');

const GCP_PROJECT_LIST_LIMIT = process.env.GCP_PROJECT_LIST_LIMIT ? process.env.GCP_PROJECT_LIST_LIMIT : 10;

exports.updateProjectIAMPolicy = async (project, serviceAccount) => {
  var pushedViewer = false;
  var pushedSecurityReviewer = false;
  var pushedCloudAssetViewer = false;
  var securityReviewerRoleName = 'roles/iam.securityReviewer';
  var viewerRoleName = 'roles/viewer';
  var cloudAssetViewerRoleName = 'roles/cloudasset.viewer';
  var member = 'serviceAccount:' + serviceAccount['email'];
  var iamPolicy = await this.getProjectIAMPolicy(project['projectId']);
  iamPolicy['bindings'].forEach(b => {
    if (b['role'] == viewerRoleName) {
      b['members'].push(member);
      pushedViewer = true;
    }
    if (b['role'] == securityReviewerRoleName) {
      b['members'].push(member);
      pushedSecurityReviewer = true;
    }
    if (b['role'] == cloudAssetViewerRoleName) {
      b['members'].push(member);
      pushedCloudAssetViewer = true;
    }
  });
  if (!pushedViewer) {
    iamPolicy['bindings'].push({ role: viewerRoleName, members: [member] });
  }
  if (!pushedSecurityReviewer) {
    iamPolicy['bindings'].push({ role: securityReviewerRoleName, members: [member] });
  }
  if (!pushedCloudAssetViewer) {
    iamPolicy['bindings'].push({ role: cloudAssetViewerRoleName, members: [member] });
  }
  var updatedIamPolicy = await this.setProjectIAMPolicy(project['projectId'], iamPolicy);
  return updatedIamPolicy;
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
    requestBody: { "policy": iamPolicy }
  };
  var r = await google.cloudresourcemanager('v1').projects.setIamPolicy(req);
  return r ? r.data : {};
};

exports.createServiceAccount = async (projectId) => {
  var req = {
    name: 'projects/' + projectId,
    requestBody: {
      'accountId': 'cloudguard-connect',
      'serviceAccount': {
        'displayName': 'CloudGuard-Connect'
      }
    }
  };
  var r = await google.iam('v1').projects.serviceAccounts.create(req);
  return r ? r.data : {};
};

exports.deleteServiceAccountKeys = async (projectId, serviceAccountEmail) => {
  var params = {
    name: 'projects/' + projectId + '/serviceAccounts/' + serviceAccountEmail
  };
  var r = await google.iam('v1').projects.serviceAccounts.keys.list(params);
  var keys = r ? r.data.keys : [];
  var promises = [];
  for (let key of keys) {
    if (key['keyType'] == 'USER_MANAGED') {
      promises.push(google.iam('v1').projects.serviceAccounts.keys.delete({ name: key['name'] }));
    }
  }
  await Q.all(promises);
};

exports.createServiceAccountKey = async (projectId, serviceAccountEmail) => {
  var params = {
    name: 'projects/' + projectId + '/serviceAccounts/' + serviceAccountEmail
  };
  var r = await google.iam('v1').projects.serviceAccounts.keys.create(params);
  return r ? r.data : {};
};

exports.getCloudGuardServiceAccount = async (projectId) => {
  // TODO: Need to handle projects with more than 100 service accounts.
  var result = {};
  var req = {
    name: 'projects/' + projectId,
    pageSize: '100' // max page size according to docs
  };
  var r = await google.iam('v1').projects.serviceAccounts.list(req);
  var serviceAccounts = r ? r.data : {};
  if (serviceAccounts['accounts']) {
    serviceAccounts['accounts'].forEach(account => {
      if (
        (account['email'].startsWith('cloudguard-connect@')) &&
        (account['displayName'] == 'CloudGuard-Connect')
      ) { result = account }
    });
  }
  return result;
};

exports.listProjects = async () => {
  // In case of onboarding a subset of the organizaion's projects, change the filter below according to your needs
  var r = await google.cloudresourcemanager('v1').projects.list({ pageSize: GCP_PROJECT_LIST_LIMIT, filter: 'lifecycleState:active AND NOT labels.dome9ignore:true' });
  return r.data['projects'] ? r.data['projects'] : [];
};

exports.addOnboardedLabel = async (project, value = 'true') => {
  var result = true;
  var parent = project['parent'] ? project['parent'] : {};
  var labels = project['labels'] ? project['labels'] : {};
  labels.dome9onboarded = value;
  var req;
  if (!Object.keys(parent).length) {
    // have to exclude parent in a project NOT under an organization
    req = {
      projectId: project['projectId'],
      requestBody: {
        labels: labels
      }
    };
  } else {
    // have to include parent in a project under an organization
    req = {
      projectId: project['projectId'],
      requestBody: {
        labels: labels,
        parent: parent
      }
    };
  }
  try {
    var r = await google.cloudresourcemanager('v1').projects.update(req);
  } catch (e) {
    console.log(e);
    result = false;
  };
  return result;
};

exports.enableRequiredAPIServices = async (projectId) => {
  var svcmgmt = google.servicemanagement('v1');
  var svcNames = [
    'compute.googleapis.com',
    'cloudresourcemanager.googleapis.com',
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
    'serviceusage.googleapis.com',
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
  var promises = [];
  for (let svcName of svcNames) {
    params = {
      consumerId: "project:" + projectId,
      serviceName: svcName
    }
    promises.push(Q.nfcall(svcmgmt.services.enable.bind(svcmgmt.services), params)
        .catch(error => {
        console.error('Error enabling service:', error);
        return null;
        }));
  }
  await Q.all(promises);
  return true;
};

const initGoogleAuthCredential = async () => {
  var r = await google.auth.getApplicationDefault();
  var client = r.credential;
  if (client) {
    try {
      client = client.createScoped([
        'https://www.googleapis.com/auth/cloud-platform',
        'https://www.googleapis.com/auth/service.management'
      ]);
    } catch (e) {
      if (e instanceof TypeError) {
        // TypeError is thrown when deployed in GCP
      } else {
        throw e;
      }
    }
  }
  google.options({
    auth: client
  });
};

initGoogleAuthCredential();
