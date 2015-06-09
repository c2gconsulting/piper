var oauth = require('./oauth.js'),
    request = require('request-promise'),
    when = require('when'),
    _ = require('underscore'),
    logger = require('../../shared/lib/log'),
    querystring = require('querystring'),
    credentials = require('../../shared/config/contextio.json');
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
        var callback_url = 'localhost';
        params['callback_url'] = callback_url;
        //optional parameter are email first and last name
        if(!token){
            logger.debug(JSON.stringify(params));
            return this.doCall(method, url, params);
        }

    }

};