var fs = require('fs');
var readline = require('readline');
var google = require('googleapis');
var googleAuth = require('google-auth-library');
var firebase = require("firebase");
// If modifying these scopes, delete your previously saved credentials
// at ~/.credentials/drive-nodejs-quickstart.json
var SCOPES = ['https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/spreadsheets'];
var TOKEN_DIR = (process.env.HOME || process.env.HOMEPATH || process.env.USERPROFILE) + '/.credentials/';
var TOKEN_PATH = TOKEN_DIR + 'drive-nodejs-quickstart.json';
var PG_TOKEN_DIR = (process.env.HOME || process.env.HOMEPATH || process.env.USERPROFILE) + '/.pagetokens/';
var PG_TOKEN_PATH = PG_TOKEN_DIR + 'page-token.dat';
var SHEET_MIME = 'application/vnd.google-apps.spreadsheet';

var gAuth;
var fbDlrPath = 'lineup-testing/DLR';
var fbDb;
var dlrRef;

//var auth;
var service = google.drive('v3');
var sheets = google.sheets('v4');

// Init FB
console.log("Init FB1");

firebase.initializeApp({
  serviceAccount: "fb_server_credential.json",
  databaseURL: "https://google-com-gstor.firebaseio.com"
});

//FB reference
fbDb = firebase.database();
dlrRef = fbDb.ref(fbDlrPath);


// Load client secrets from a local file.
fs.readFile('client_secret.json', function processClientSecrets(err, content) {
    if (err) {
        console.log('Error loading client secret file: ' + err);
        return;
    }
    // Authorize a client with the loaded credentials, then call the
    // Drive API.
    //    authorize(JSON.parse(content), listFiles);
    authorize(JSON.parse(content), initProcess);
});
/**
 * Create an OAuth2 client with the given credentials, and then execute the
 * given callback function.
 *
 * @param {Object} credentials The authorization client credentials.
 * @param {function} callback The callback to call with the authorized client.
 */
function authorize(credentials, callback) {
    var clientSecret = credentials.installed.client_secret;
    var clientId = credentials.installed.client_id;
    var redirectUrl = credentials.installed.redirect_uris[0];
    auth = new googleAuth();
    var oauth2Client = new auth.OAuth2(clientId, clientSecret, redirectUrl);
    // Check if we have previously stored a token.
    fs.readFile(TOKEN_PATH, function (err, token) {
        if (err) {
            getNewToken(oauth2Client, callback);
        }
        else {
            oauth2Client.credentials = JSON.parse(token);
            callback(oauth2Client);
        }
    });
}
/**
 * Get and store new token after prompting for user authorization, and then
 * execute the given callback with the authorized OAuth2 client.
 *
 * @param {google.auth.OAuth2} oauth2Client The OAuth2 client to get token for.
 * @param {getEventsCallback} callback The callback to call with the authorized
 *     client.
 */
function getNewToken(oauth2Client, callback) {
    var authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline'
        , scope: SCOPES
    });
    console.log('Authorize this app by visiting this url: ', authUrl);
    var rl = readline.createInterface({
        input: process.stdin
        , output: process.stdout
    });
    rl.question('Enter the code from that page here: ', function (code) {
        rl.close();
        oauth2Client.getToken(code, function (err, token) {
            if (err) {
                console.log('Error while trying to retrieve access token', err);
                return;
            }
            oauth2Client.credentials = token;
            storeToken(token);
            callback(oauth2Client);
        });
    });
}
/**
 * Store token to disk be used in later program executions.
 *
 * @param {Object} token The token to store to disk.
 */
function storeToken(token) {
    try {
        fs.mkdirSync(TOKEN_DIR);
    }
    catch (err) {
        if (err.code != 'EEXIST') {
            throw err;
        }
    }
    fs.writeFile(TOKEN_PATH, JSON.stringify(token));
    console.log('Token stored to ' + TOKEN_PATH);
}


function initProcess(auth) {
    gAuth = auth;
    fs.readFile(PG_TOKEN_PATH, 'ascii', function (err, content) {
        if (err) {
            if (err.code === "ENOENT") {
                console.log("File not found: ", PG_TOKEN_PATH);
                service.changes.getStartPageToken({
                    auth: auth
                }, function (pgErr, pgRes) {
                    var pgToken = pgRes.startPageToken;
                    console.log("Start page token: ", pgToken);
                    retrieveChanges(pgToken, auth);
                });
            }
            else {
                console.log("Error opening file: ", err.code);
                throw err;
            }
        }
        else {
            if (content != null && content != '') {
                var pgToken = content;
                console.log("Existing page token: ", pgToken);
                retrieveChanges(pgToken, auth);
            }
            else {
                console.log("Existing page token empty, exiting");
            }
        }
    });
}

function retrieveChanges(pgToken, auth) {
    service.changes.list({
        auth: auth
        , pageToken: pgToken
        , pageSize: 1000
    }, function (cErr, cRes) {
        if (cErr) {
            console.log("Error getting changes: ", cErr);
            throw cErr;
        }
        else {
            var num = 1;
            var fileId;
            console.log("+++++++++++++ 1", cRes);
            cRes.changes.forEach(function (item) {
                console.log("--------------", item.file);
                if (!item.removed) {
                    if (item.file.mimeType === SHEET_MIME && item.file.name === "LG-DLR") { //regex will be used to determine..
                        fileId = item.fileId;
                        console.log(num + ". File ID : " + fileId);
                        console.log(num + ". File name : " + item.file.name); // do some regex filtering later to get device lineup
                        getSheetVal(auth, fileId);
                        num = num + 1;
                    }
                }
            });
            if (cRes.newStartPageToken) {
                storePgToken(cRes.newStartPageToken);
            }
            if (cRes.nextPageToken) {
                retrieveChanges(cRes.nextPageToken, auth); //to be implemented but pageSize = 1000.. no worries?
            }
        }
    });
}

function getSheetVal(auth, fileId) {
    var obj = {};
    sheets.spreadsheets.values.get({
        auth: auth
        , spreadsheetId: fileId
        , range: 'Sheet1!A2:F1000'
    , }, function (sErr, sRes) {
        if (sErr) {
            console.log('The API returned an error: ' + sErr);
            return;
        }
        var rows = sRes.values;
        if (rows.length == 0) {
            console.log('No data found.');
        }
        else {
            var modYear;
            var brand;
            var odm;
            var devModNum;
            var soc;
            var socMod;
            
            for (var i = 0; i < rows.length; i++) {
                var row = rows[i];
                // Print columns A and E, which correspond to indices 0 and 4.
                console.log('%s, %s, %s, %s, %s, %s', row[0], row[1], row[2], row[3], row[4], row[5]);
                
                modYear = row[0];
                brand = row[1];
                odm = row[2];
                devModNum = row[3];
                soc = row[4];
                socMod = row[5];
                
                obj = {
                    device_model_year: modYear,
                    device_brand: brand,
                    odm: odm,
                    device_model_number: devModNum,
                    soc: soc,
                    soc_model: socMod
                }
                
                console.log("Ojbect-----------", obj);
                dlrRef.child('LG').child(devModNum).set(obj);
            }
            //set 'LG' manually.. determin this child name from parnter name
        }
    });
}

function storePgToken(pgToken) {
    try {
        fs.mkdirSync(PG_TOKEN_DIR);
    }
    catch (err) {
        if (err.code != 'EEXIST') {
            throw err;
        }
    }
    fs.writeFile(PG_TOKEN_PATH, pgToken);
    console.log('Token stored to ' + PG_TOKEN_PATH);
}