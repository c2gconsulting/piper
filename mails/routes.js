var express = require('express');
var router = express.Router();
var cache = require('../shared/lib/cache').getRedisClient();
var logger = require('../shared/lib/log');
var mq = require('../shared/lib/mq');
var mailClient = require('./lib/calls');

//define routes
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
router.get('/users', function(req, res){
    mailClient.users('get')
        .then(function(result) {
            res.end(result);
        }, function(error){
            if(typeof error !== 'string') error = JSON.stringify(error);
            logger.error('Something went wrong please check error \n' + error);
            res.end(error);
        })
});
router.get('/connect_token', function(req, res){
   var token = req.query.contextio_token;
    if(token) logger.info('Receved token is \n' + token);
    logger.info('other parameters recevied are \n' + JSON.stringify(req.query));
});

router.get('/connect', function(req, res){
    var email = req.query.email,
        firstname = req.query.firstname,
        lastname = req.query.lastname,
        params = { email : email, first_name : firstname, last_name : lastname};
    mailClient.connect_tokens('post', params)
        .then(function(result) {
            //check if result has a browser_redirect_url if true then redirect the user for authentication
            result = JSON.parse(result)
            if(result.hasOwnProperty('browser_redirect_url'))logger.info('Request has a redirect url');
            res.redirect(result.browser_redirect_url);
        }, function(error){
            if(typeof error !== 'string') error = JSON.stringify(error);
            logger.error('Something went wrong please check error \n' + error);
            res.end(error);
        })
});

router.get('/connected_tokens', function(req, res){
    mailClient.connect_tokens('get')
        .then(function(result) {
            res.end(result);
        }, function(error){
            if(typeof error !== 'string') error = JSON.stringify(error);
            logger.error('Something went wrong please check error \n' + error);
            res.end(error);
        })
});

router.get('/callback', function(req, res){
   logger.info('Recevied with params ' + JSON.stringify(req.query));
});
module.exports = router;