var express = require('express');
var router = express.Router();
var cache = require('../shared/lib/cache').getRedisClient();
var logger = require('../shared/lib/log');
var mq = require('../shared/lib/mq');
var credentials = require('../shared/config/contextio.json');
/*global ContextIO, console*/
var ContextIO = require('contextio');
var ctxioClient = new ContextIO.Client('2.0', 'https://api.context.io', { key: credentials['key'], secret: credentials['secret'] });

//define routes
//define root
router.get('/', function(req, res){
    res.render('pages/index', {id: null});
});

router.post('/contextio', function(req, res){
    logger.debug('message received from context io \n showing body \n');
    var body = JSON.stringify(req.body);
    logger.debug(body);
    res.end('OK');
});

router.post('/contextio-failure', function(req, res){
    logger.debug('message received from context io failure \n showing body \n');
    var body = JSON.stringify(req.body);
    logger.debug(body);
    res.end('OK');
});
router.get('/accounts', function(req, res){
    ctxioClient.accounts().get({limit:15}, function (err, response) {
        if (err) throw err;
        res.end(JSON.stringify(response.body));
    });
});
router.get('/connect_token', function(req, res){
   var token = req.query.contextio_token;
    if(token) logger.info(token);
});
router.get('/callback', function(req, res){
   logger.info('Recevied with params ' + JSON.stringify(req.query));
});
module.exports = router;