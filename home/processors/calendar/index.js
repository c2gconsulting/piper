var EventEmitter = require('events').EventEmitter;
var cache = require('../../../shared/lib/cache').getRedisClient();
var logger = require('../../../shared/lib/log');
var mq = require('../../../shared/lib/mq');
var utils = require('../../../shared/lib/utils');
var scheduler = require('../../../shared/lib/scheduler');
var User = require('../../../shared/models/User');
CACHE_PREFIX = 'calendar_events:';
cache.on("error", function(err){
    logger.error("Redis Error: " + err)
});
function calendar(data){
    EventEmitter.call(this);
    this.pub = mq.context.socket('PUB', {routing: 'topic'});
    this.sub = mq.context.socket('SUB', {routing: 'topic'});
    this.msgid = new Date().getTime();
    var me = this;
}
function getUserKey(username, clientHandle) {
    return CACHE_PREFIX + username + '@' + clientHandle;
}

/**
 * Receive a message for processing from the front-end
 * @param user - the user making the request
 * @param client - the company that owns this message
 * @param body - JSON object with request details
 */
Rides.prototype.out = function(user, client, body) {
    var me = this;
    //define handler keys
    //this.handlerKeys = {
    //    'calendar_get_events': [
    //
    //    ]
    //}
    logger.debug("message received with body\n" + JSON.stringify(body));
}