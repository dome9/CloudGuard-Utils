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

const axios = require('axios');

const D9_BASE_URL = process.env.D9_BASE_URL ? process.env.D9_BASE_URL : 'https://api.dome9.com/v2';
/** Must trim values when using secrets. */
const D9_ID = process.env.D9_ID.trim();
const D9_SECRET = process.env.D9_SECRET.trim();

const D9_CLIENT = axios.create({
  baseURL: D9_BASE_URL,
  auth: {
    username: D9_ID,
    password: D9_SECRET
  }
});

exports.getGoogleCloudAccounts = async () => {
  var r = await D9_CLIENT.get('/GoogleCloudAccount');
  return r ? r.data : [];
};

exports.getGoogleCloudAccountsWithMissingPermissions = async () => {
  var r = await D9_CLIENT.get('/GoogleCloudAccount/MissingPermissions');
  return r ? r.data : [];
};

exports.getGoogleCloudAccountsMap = async () => {
  var m = new Map();
  var cloudAccounts = await this.getGoogleCloudAccounts();
  cloudAccounts.forEach(account => {
    m.set(account.projectId, { "id": account.id, "name": account.name });
  });
  return m;
};

exports.getMissingPermissionsSet = async () => {
  var s = new Set();
  var r = await this.getGoogleCloudAccountsWithMissingPermissions();
  r.forEach(account => {
    var actions = account.actions;
    if (!(actions === undefined || actions.length == 0)) {
      s.add(account.id);
    }
  });
  return s;
};

exports.createGoogleCloudAccount = async (projectName, privateKeyData) => {
  var payload = { "name": projectName, "serviceAccountCredentials": privateKeyData };
  var r = await D9_CLIENT.post(
    '/GoogleCloudAccount',
    payload,
    {
      headers: {
        "Content-Type": "application/json;charset=utf-8"
      }
    }
  );
  return r ? r.data : {};
};