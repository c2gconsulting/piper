var request = require('request-promise');
var utils = require('../../shared/lib/utils');

// AUTH details
var SLACK_CLIENT_ID = "wTO4c5RIwLi_gjwN1tw79JY4_1W2Im1w";
var SLACK_SERVER_TOKEN = "56IrLXS0bglH4WT695YKkXIpaojpHmfoTgn3qE83";
var SLACK_SECRET = "oKXU97Mj_5Po9udA666Tl-wfUt93-u0oPAbk8_NS";


// Endpoints
var base_url = exports.base_url = "https://slack.com/api/",
    access_token_url = exports.access_token_url = "https://login.slack.com/oauth/token",
    authorize_url = exports.authorize_url = "https://login.slack.com/oauth/authorize",
    login_url = exports.login_url = "https://login.slack.com",
    redirect_uri = exports.redirect_uri = "https://piperlabs.com/slackAuth";

var scope = 'read post profile';


/**
 * getAuthorizeLink Returns the uber auth link. 
 * @param state Unique tag representing the user to be used to identify the caller
 * @param responseType (optional). Defaults to 'code'
 */
var getAuthorizeLink = function (state, responseType) {
    if (!responseType) responseType = 'code';
    return authorize_url + '?response_type=' + responseType + '&client_id=' + SLACK_CLIENT_ID + '&state=' + state + '&scope=' + scope; 
};
 
 
/**
 * getUserAccessToken Retrieve access token for user authorization code. 
 * @param code The authorization code
 */
var getUserAccessToken = function (code) {
    var requrl = {
        url : access_token_url,
        method : 'post',
        qs : {
            'client_secret': SLACK_SECRET,
            'client_id': SLACK_CLIENT_ID,
            'grant_type': 'authorization_code',
            'redirect_uri': redirect_uri,
            'code': code
        }
    };
    
    return request(requrl).then(function(data) {
        try {
            return JSON.parse(data);
        } catch (e) {
            return data;
        }
     });
};

/**
 * refreshUserToken Retrieve access token for user authorization code. 
 * @param refreshToken The authorization code
 */
var refreshUserToken = function (refreshToken) {
    var requrl = {
        url : access_token_url,
        method : 'get',
        qs : {
            'client_secret': SLACK_SECRET,
            'client_id': SLACK_CLIENT_ID,
            'grant_type': 'refresh_token',
            'redirect_uri': redirect_uri,
            'refresh_token': refreshToken
        }
    };
    
    return request(requrl).then(function(data) {
        try {
            return JSON.parse(data);
        } catch (e) {
            return data;
        }
     });
};


/**
 * postRequest Processes a post API call.
 * @param params is the hash of all request parameters
 */
var postRequest = function (method, params) {
    var requrl = {
        url : base_url + method,
        method : 'post',
        qs : params
    };
    
    return request(requrl).then(function(data) {
        try {
            return JSON.parse(data);
        } catch (e) {
            return data;
        }
     });

};



module.exports.getAuthorizeLink = getAuthorizeLink;
module.exports.postRequest = postRequest;
module.exports.getUserAccessToken = getUserAccessToken;
  
  