var request = require('request-promise');
var xml2js = require('xml2js');
var when = require('when');
var Promise = require('bluebird');
var logger = require('../../../../shared/lib/log');
var cache = require('../../../../shared/lib/cache').getRedisClient();
var CACHE_PREFIX = 'chitchat:';
var CONV_TTL = 600;

var parseString = Promise.promisify(xml2js.parseString);

function processMessage(username, clientHandle, text){
    var userkey = username + '@' + clientHandle;
    var requrl = {
        'url': 'http://www.botlibre.com/rest/botlibre/form-chat',
        'method': 'get',
        'qs': {'instance': 165, 'message': text}
    };
    
    //check if user has an active conversation
    return cache.get(CACHE_PREFIX + userkey)
        .then(function(res){
            if (res) requrl['qs']['conversation'] = res; // set conversation id if it exists
            return request(requrl).then(function(data) {
               return parseString(data).then(function(result){
                    if(result) {
                        var reply = result['response']['message'][0]; 
                        reply = reply.replace('Anonymous', username);
                        
                        // Persist active conversation session
                        var conversationId = result['response']['$']['conversation'];
                        if (conversationId) updateCache(userkey, conversationId);
                        return reply;
                    } else {
                        return false; //cannot parse response string
                    }
                });
            });
        });
}

function updateCache(userkey, conversationId) {
    var cacheKey = CACHE_PREFIX + userkey;
    if (conversationId) {
        cache.set(cacheKey, conversationId)
            .then(function (response) {
                cache.expire(cacheKey, CONV_TTL);
            });
    }
}

module.exports.processMessage = processMessage;
