var https = require('https');
var db = require('../shared/lib/db');
var mq = require('../shared/lib/mq');
var logger = require('../shared/lib/log');
var express = require('express');
var rd_client = require('../shared/lib/cache').getRedisClient();
var when = require('when');
var calEvent = require('./lib/calendar');
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
logger.info('Google calendar Handler Connecting to Message Queue <piper.events.out>... ');
sub.connect('piper.events.out', 'events.*', function(){
   logger.info('Google events.* succesfully connected to <piper.events.out>');
});

//define routes

router.get('/', function(req, res){
    res.end('<H1>Welcome to C2G PIPER Google Calendar HANDLER</H1>');
});

router.get('/events', function(req, res){
    //set username for events
    var user = req.query.username;
    var client = req.query.client;
    var data = {user: user, client: client };
    if(user && client) calEvent.authorize(data, function(auth){
        console.log('the auth received is' + JSON.stringify(auth));
        calEvent.getEvents(auth)
            .then(function(events){
                console.log('This was called expecting events');
                res.end(JSON.stringify(events));
            }, function(err){
                console.log('This error was called');
                res.end(JSON.stringify(err));
            }
        );
    })
});
router.get('/calendar', function(req, res){
    res.render('index');
});

sub.on('data', function(data) {
    jsonData = JSON.parse(data);
    if (data) onMessage(jsonData);
});

var onMessage = function (data) {
    logger.debug('onMessage data processing occurs here');
};

/**
 * Push a message to the message exchange for a handler to pick up
 * @param user - user that owns this message
 * @param client - handle of the company that owns this message
 * @param body - JSON object with message to be processed by the handler
 */
var push = function(user, client, body) {
    data = { 'id': new Date().getTime(), 'user': user, 'client': client, 'body': body };
    logger.info('google_calendar_handler: Connecting to MQ Exchange <piper.events.in>...');
    pub.connect('piper.events.in', function() {
        logger.info('google_calendar handler:  MQ Exchange <piper.events.in> connected');
        logger.debug('push message to the relivant subscriber');
    });
};
