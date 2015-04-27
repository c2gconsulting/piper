var https = require('https');
var db = require('../shared/lib/db');
var mq = require('../shared/lib/mq');
var logger = require('../shared/lib/log');
var express = require('express');
var rd_client = require('../shared/lib/cache').getRedisClient();
var CACHE_PREFIX = 'piper-travel-handler:';
//require travel class that does actual activities
var tclass = require('../api/processors/travelRequest/travelClass');
//for beta processing
var betap = require('../api/processors/travelRequest/betaProc');
//require redis cache clear settings
var ttl_time = require('../api/processors/travelRequest/settings');
//require geocode js
var geocode = require('./geocode');
var when = require('when');

// Create the Express application
var app = exports.app = express();
var router = express.Router(); // Create our Express router
app.use('/', router);

var pub = mq.context.socket('PUB', {routing: 'topic'});
var sub = mq.context.socket('SUB', {routing: 'topic'});
var msgid = new Date().getTime();
/*
 * Bind to all subscribed clients...
 */
db.getModel('travel_subscribers', function(err, model) {
    if (err) {
        logger.error('Fatal error: ' + err + '. Please resolve and restart the service'); // Unable to retrieve travel_subscribers db object
    } else {
        TSubscriber = model;
    }
});

TSubscriber.find({}, function (err, subscribers) {
    if (!err && subscribers && subscribers.length > 0){
        for (var i in subscribers) {
            logger.info('TRAVEL Handler <piper.events.out>: Binding to %s.travel...', subscribers[i].handle);
            sub.connect('piper.events.out', subscribers[i].handle + '.travel');
        }
    } else {
        logger.info('No subscribers currently registered or active, listening for new clients...');
    }
});

sub.on('data', function(data) {
    jsonData = JSON.parse(data);
    if (data) onMessage(jsonData.id, jsonData.user, jsonData.client, jsonData.body);
});

var onMessage = function (id, user, client, body) {
    if (msgid !== id) {
        var rkey = CACHE_PREFIX + user.name + '@' + client.slackHandle;;
        var fn = new tclass(body);
        var reply = '';
        var entity = fn.entGet();
        logger.info("check returned entity : " + JSON.stringify(entity));
            try {

                //set and update record in redis cache
                rd_client.hmset(rkey,entity, function(err, status) {
                    if(err) {
                        logger.error('Error occurred during redis operation ' + err);
                    } else {
                        logger.info('redis set value status ' + status);
                        //get all cached data including update and process with betaProc
                        rd_client.hgetall(rkey, function(err, result) {
                            if (err) {
                                logger.info('An error occured when retrieving cached data ' + err );
                            } else {
                                logger.info('Returned object from hgetall' + JSON.stringify(result));
                                //use betap processing to return response;
                                reply = betap(result);
                                push(user, client, { 'text': reply });
                            }
                        });
                    }

                });
               // after retrieving the record call method check parameters to populate response
            } catch(e){
                logger.error("exception during leave processing " + e);
            }
        //reset Cache expiration

        rd_client.expire(rkey, ttl_time.LEAVE_CACHE_TIMEOUT);
        msgid = id;
    }
}

/**
 * Push a message to the message exchange for a handler to pick up
 * @param user - user that owns this message
 * @param client - handle of the company that owns this message
 * @param body - JSON object with message to be processed by the handler
 */
var push = function(user, client, body) {
    data = { 'id': new Date().getTime(), 'user': user, 'client': client, 'body': body };
    logger.info('TRAVEL Handler: Connecting to MQ Exchange <piper.events.in>...');
    pub.connect('piper.events.in', function() {
        logger.info('TRAVEL Handler:  MQ Exchange <piper.events.in> connected');
        pub.publish('travel', JSON.stringify(data));
    });
}
//define root
router.get('/', function(req, res){
   res.end('<H1>Welcome to C2G PIPER TRAVEL HANDLER</H1>');
});

router.get('/subscribe', function(req, res) {
    var handle = req.query.handle;

    if (handle) {
        if (subscribeClient(handle)){
            res.end('Client ' + handle + ' successfully subscribed and activated');
        } else {
            res.statusCode = 422;
            res.end('Unable to subscribe client ' + handle);
        }
    } else {
        res.statusCode = 422;
        res.end ('Missing parameter for handle');
    }
});

// get geocode
router.get('/getcode', function(req, res){
    var address = req.query.address;
    geocode.getCode(address).then(function(x){res.end(x)});
});


router.get('/nearby', function(req, res) {
    var address = req.query.address;
    geocode.getNearby(address)
        .then(function(d){
        res.end(JSON.stringify(d));
    })
});

router.get('/getroutes', function(req, res){
   var src = req.query.source, dst = req.query.destination;
    geocode.getRoutes(src, dst)
        .then(function(x) {
            res.end(JSON.stringify(x));
        });
});
var subscribeClient = function(handle) {
    try {
        // Check if client already registered
        TSubscriber.findOne({ handle:handle }, function (err, newClient) {
            if (!err && newClient) {
                // client already exists - exit
                logger.info('Client ' + handle + ' already subscribed');
            } else {
                var c = new TSubscriber({ 'handle': handle, 'createdAt': new Date() });
                c.save(function(err) {
                    if (err) {
                        logger.error('Cannot subscribe new client: ' + err);
                    } else {
                        logger.info('Client successfully subscribed, firing up MQ listener...');
                        sub.connect('piper.events.out', handle + '.travel', function() {
                            logger.info('TRAVEL Handler <piper.events.out>: Bound to %s.travel', handle);
                        });
                    }
                });
            }
        });
        return true;
    } catch (e) {
        logger.error('Unable to subscribe new client: ' + e);
        return false;
    }
}
