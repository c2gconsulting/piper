//require travel class that does actual activities
var tclass = require('./travelClass');
//for beta processing
var betap = require('./betaProc');
//require redis cache clear settings
var ttl_time = require('./settings');
//require events emmitter to emit message event
var EventEmitter = require('events').EventEmitter;
//logger
var logger = require('../../../shared/lib/log');
//mq
var mq = require('../../../shared/lib/mq');

//using redis to temporarily cache data;
var rd_client = require('../../../shared/lib/cache').getRedisClient();
rd_client.on('error', function(error) {
    console.log("Redis Error " + error );
});

var CACHE_PREFIX = 'travel:';
var MODULE = 'TRAVEL';


function BookFlight(data) {
    EventEmitter.call(this);
    this.pub = mq.context.socket('PUB', {routing: 'topic'});
    this.sub = mq.context.socket('SUB', {routing: 'topic'});
    this.msgid = new Date().getTime();
}

BookFlight.prototype = Object.create(EventEmitter.prototype);
BookFlight.prototype.constructor = BookFlight;

BookFlight.prototype.init = function(){
    // subscribe to inbound MQ exchange
    logger.info('%s Processor: Connecting to MQ Exchange <piper.events.in>...', MODULE);
    this.sub.connect('piper.events.in', MODULE.toLowerCase(), function() {
        logger.info('%s Processor: <piper.events.in> connected', MODULE);
    });
    var me = this;
    this.sub.on('data', function(data) {
        jsonData = JSON.parse(data);
        if (data) me.in(jsonData.id, jsonData.user, jsonData.client, jsonData.body);
    });

};

/**
 * Receive a message from back-end handlers for processing
 * @param username - the user this request is associated with
 * @param clientHandle - handle of the company that owns this message
 * @param body - JSON object with request details
 */
BookFlight.prototype.in = function(msgid, username, clientHandle, body) {
    var me = this;

    // check for message uniqueness
    if (this.msgid !== msgid) {
        //cache.sismember(CACHE_PREFIX + username + '@' + clientHandle + ':msgid', msgid, function(err, check) {
        //	if (!err && check === 0) {
        // not duplicate, process
        //		logger.warn('MESSAGE deets ' + msgid + JSON.stringify(body));
        //		cache.sadd(CACHE_PREFIX + username + '@' + clientHandle + ':msgid', msgid);
        me.emit('message', MODULE, username, clientHandle, body.text);
        //	}
        //});
        this.msgid = msgid;
    }
    //cache.expire(CACHE_PREFIX + username + '@' + clientHandle + ':msgid', MSGKEYS_TTL);
}

//recieve a message from the front end
BookFlight.prototype.out = function(username, client, body) {
    this.push(username, client.slackHandle, body);
}
/**
 * Push a message to the message exchange for a handler to pick up
 * @param clientHandle - handle of the company that owns this message
 * @param message - JSON object with message to be processed by the handler
 */
BookFlight.prototype.push = function(username, clientHandle, body) {
    data = {  'id': new Date().getTime(), 'user': username, 'client': clientHandle, 'body': body };
    logger.info('%s Processor: Connecting to MQ Exchange <piper.events.out>...', MODULE);
    var me = this;
    this.pub.connect('piper.events.out', function() {
        logger.info('%s Processor: <piper.events.out> connected', MODULE);
        me.pub.publish(clientHandle + '.' + MODULE.toLowerCase(), JSON.stringify(data));
    });
}

module.exports = BookFlight;