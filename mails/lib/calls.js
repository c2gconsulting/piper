var oauth = require('./oauth.js'),
    request = require('request-promise'),
    when = require('when'),
    _ = require('underscore'),
    logger = require('../../shared/lib/log'),
    querystring = require('querystring'),
    credentials = require('../../shared/config/contextio.json');
//require mailUser Model
var MailUser = require('../../shared/models/MailUser'); // why do I need this?

var authKey = {
    oauth_consumer_key: credentials['key'],
    oauth_version: '1.0'
};
module.exports = Client = {
    //make request and return promise
    doCall : function(method, url, reqParams){
        var authparams = _.extend({}, reqParams);
        var OAuthMsg = {
            method: method,
            action: url,
            parameters: _.extend(authparams, authKey)
        };

        oauth.setTimestampAndNonce(OAuthMsg);
        oauth.SignatureMethod.sign(OAuthMsg, {
            consumerSecret: credentials['secret'],
            tokenSecret: ''
        });

        var requrl = {
            'url': url,
            'method': method,
            'headers': {
                Authorization: oauth.getAuthorizationHeader(OAuthMsg.parameters),
                'User-Agent': 'Piper context IO Library'
            }
        };
        if(method == 'post') {
            requrl['body'] = querystring.stringify(reqParams);
            requrl.headers['Content-Type'] = 'application/x-www-form-urlencoded';
        }
        if(method == 'get') requrl['qs'] = reqParams;
        return request(requrl);
    },
    //@id : Users id
    //@params : query string e.g ?email=mocheje@c2gconsulting.com
    // subrc : sub resource to access
    users : function(method, params, id){
        var url = 'https://api.context.io/lite/users';
        if(!id){
            return this.doCall(method, url, params )
        }


    },
    connect_tokens : function(method, params, token){
        var url = 'https://api.context.io/lite/connect_tokens';
        var callback_url = 'http://mails.piperlabs.io:3000/connect_token';
        //optional parameter are email first and last name
        if(!token){
            //and method is post
            if(method.toLowerCase() == 'post') params['callback_url'] = callback_url;
            logger.debug(JSON.stringify(params));
            return this.doCall(method, url, params);
        } else{
            //add /token to the url (available methods = 'GET', 'DELETE')
            url += '/' + token;
            return this.doCall( method, url, params);
        }

    },
    webhooks : function(method, userid, params, webhookid ){
        if(userid) { // we can remove our local check since any invalid request will return a type error
            var url = 'https://api.context.io/lite/users/' + userid + '/webhooks';
            //if webhookid then url += /webhookid
            if(webhookid) url += '/' + webhookid ; // available methods are ('GET, POST, DELETE')
            //available methods are ('GET' and 'POST')
            return this.doCall(method, url, params); //
        }
    }

};