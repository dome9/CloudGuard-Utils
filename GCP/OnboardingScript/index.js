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

const { v4: uuidv4 } = require('uuid');
const auth = require('./lib/auth');
const dome9 = require('./lib/dome9');
const gcp = require('./lib/gcp');
let onboarded = 0;
let failed = 0;

/**
 * Onboards GCP projects to Check Point CloudGuard CSPM a.k.a. Dome9.
 * @param {Express.Request} req The API request.
 * @param {Express.Response} res The API response.
 */
exports.d9AutobrdOnboard = async (req, res) => {
  var execId = uuidv4();
  console.log("d9-autobrd execution started", execId);
  var timeLabel = "d9-autobrd execution finished " + execId;
  console.time(timeLabel);
  var jsonResp = { 'exec_id': execId };
  try {
    var gcpIsGo = false;
    switch (req.method) {
      case 'GET':
        if (auth.check(req.query.psk)) {
          gcpIsGo = true;
        } else {
          res.status(401);
          console.error('Authentication failure');
        }
        break;
      case 'POST':
        if (auth.check(req.body.psk)) {
          gcpIsGo = true;
        } else {
          res.status(401);
          console.error('Authentication failure');
        }
        break;
      default:
        res.status(405);
        console.error('Method not allowed:', req.method);
        break;
    }
    if (gcpIsGo) {
      results = await onboardGoogleProjects();
      jsonResp['results'] = results
      console.log("onboarded:", results.onboarded, "failed:", results.failed, "skipped:", results.skipped, "total:", results.total);
    }
  } catch (e) {
    res.status(500);
    jsonResp['error'] = 'true';
    console.error(e);
  }
  console.timeEnd(timeLabel);
  res.send(jsonResp);
};

async function createAccountAsync(p, saPrivateKeyData, retries = 3, delay = 1000) {
    try {
        var r = await dome9.createGoogleCloudAccount(p['name'], JSON.parse(saPrivateKeyData));
        if (r.id) {
            console.log(p['projectId'], "=>", "Project was onboarded successfully");
            onboarded++;
        }
    } catch (error) {
        if (retries === 0) {
            console.error(`${p['projectId']}, '=>', "Error creating project in Dome9. No more retries.", ${error}`);
            throw error;
        } else {
            console.log(`${p['projectId']} => Error creating project in Dome9. Retrying... attempts left: ${retries - 1}`);
            await new Promise(res => setTimeout(res, delay));
            return createAccountAsync(p, saPrivateKeyData, retries - 1, delay + 1000);
        }
    }
}

async function onboardAsync(p, cloudAccountsMap, missingPermissionsSet, retries = 3, delay = 1000) {
    try {
      if (clearToBoard(p, cloudAccountsMap)) {
        var serviceAccount = await gcp.getCloudGuardServiceAccount(p['projectId']);
        if (!serviceAccount['email']) {
          serviceAccount = await gcp.createServiceAccount(p['projectId']);
          console.log(p['projectId'], "=>", "Created 'CloudGuard-Connect' service account");
        } else {
          await gcp.updateProjectIAMPolicy(p, serviceAccount);
          await gcp.deleteServiceAccountKeys(p['projectId'], serviceAccount['email']);
          console.log(p['projectId'], "=>", "Deleted all 'CloudGuard-Connect' service account keys");
        }
        var saKey = await gcp.createServiceAccountKey(p['projectId'], serviceAccount['email']);
        console.log(p['projectId'], "=>", "Created new 'CloudGuard-Connect' service account key");
        var saPrivateKeyData = Buffer.from(saKey['privateKeyData'], 'base64').toString();
        await createAccountAsync(p, saPrivateKeyData);
        cloudAccountsMap.set(p['projectId'], true)
      }
      if (await gcp.enableRequiredAPIServices(p['projectId'])) {
        console.log(`${p['projectId']} => Enabled all required API services in project`);
      }
      return true;
    } catch (error) {
        if (retries === 0) {
            console.error(`${p['projectId']} => "Error onboarding project. No more retries.`);
            throw error;
        }
        console.log(`${p['projectId']} => Error onboarding project. Retrying... attempts left: ${retries - 1}`);
        await new Promise(res => setTimeout(res, delay));
        return onboardAsync(p, cloudAccountsMap, missingPermissionsSet, retries - 1, delay + 1000);
    }
}

const onboardGoogleProjects = async () => {
  var cloudAccountsMap = await dome9.getGoogleCloudAccountsMap();
  var missingPermissionsSet = await dome9.getMissingPermissionsSet();
    await gcp.initGoogleAuthCredential();
    var projects = await gcp.listProjects();
    var total = projects.length;
  onboarded = 0;
  failed = 0;

  for (let p of projects) {
      console.log(`${p['projectId']} => Starting onboarding process`);
      try {
          await onboardAsync(p, cloudAccountsMap, missingPermissionsSet);
      } catch (error) {
          failed++;
          console.error(`${p['projectId']} => Error onboarding project`, error);
      }
  }
  return {onboarded: onboarded, failed: failed, skipped: (total - onboarded - failed), total: total};
};

const clearToBoard = (project, cloudAccountsMap) => {
  var result = false;
  const projectId = project['projectId'];
  const projectInDome9 = isProjectInDome9(projectId, cloudAccountsMap);
  if (projectInDome9) {
    console.log(projectId, "=>", "Project was already onboarded");
  } else {
    result = !projectInDome9;
  }
  return result;
};

const isProjectInDome9 = (projectId, cloudAccountsMap) => {
  return cloudAccountsMap.has(projectId);
};