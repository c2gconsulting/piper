var https = require('https');
var db = require('../shared/lib/db');
var mq = require('../shared/lib/mq');
var logger = require('../shared/lib/log');
var express = require('express');
var rd_client = require('../shared/lib/cache').getRedisClient();
var when = require('when');
var path = require('path');
var bodyParser = require('body-parser');
// Create the Express application
var app = exports.app = express();
var router = express.Router(); // Create our Express router

// configure app
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// use middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(require('./routes'));


var pub = mq.context.socket('PUB', {routing: 'topic'});
var sub = mq.context.socket('SUB', {routing: 'topic'});
var msgid = new Date().getTime();
/*
connect to message queue
*/
logger.info('Mails Handler usign contexio Connecting to Message Queue <piper.events.out>... ');
sub.connect('piper.events.out', 'mails.*', function(){
   logger.info('Mails Handler mails.* succesfully connected to <piper.events.out>');
});

sub.on('data', function(data) {
    jsonData = JSON.parse(data);
    if (data) onMessage(jsonData);
});

var onMessage = function (data) {
    logger.debug(JSON.stringify(data));
    //call push to push the data to the inbound controller///after other processing
    if(data.process){
        push(data.user, data.client, JSON.parse(data.body));
    } else{
        //no body.. set processor to process default
        push(data.user, data.client);
    }

};

/**
 * Push a message to the message exchange for a handler to pick up
 * @param user - user that owns this message
 * @param client - handle of the company that owns this message
 * @param body - JSON object with message to be processed by the handler
 */
var push = function(user, client, body) {
    data = { 'id': new Date().getTime(), 'user': user, 'client': client, module:'CALENDAR', 'body': body };
    logger.info('All mails handler: Connecting to MQ Exchange <piper.events.in>...');
    pub.connect('piper.events.in', function() {
        logger.info('mails handler:  MQ Exchange <piper.events.in> connected');
        pub.publish(mq.CONTROLLER_INBOUND, JSON.stringify(data));
    });
};
