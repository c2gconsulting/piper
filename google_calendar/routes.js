//var express = require('express');
//var router = express.Router();
//var calEvent = require('./lib/calendar');
////define routes
////define root
//router.get('/', function(req, res){
//    res.end('<H1>Welcome to C2G PIPER Google Calendar HANDLER</H1>');
//});
//
//router.get('/events', function(req, res){
//    //set username for events
//    var user = req.query.username;
//    var client = req.query.client;
//    var data = {user: user, client: client };
//    if(user && client) calEvent.authorize(data, function(auth){
//        console.log('the auth received is' + JSON.stringify(auth));
//        calEvent.getEvents(auth)
//            .then(function(events){
//                console.log('This was called expecting events');
//                res.end(JSON.stringify(events));
//            }, function(err){
//                console.log('This error was called');
//                res.end(JSON.stringify(err));
//            }
//        );
//    })
//});
//router.get('/calendar', function(req, res){
//    res.render('index');
//});
//
//// url for google calendar push notification;
//router.post('/calendarpush', function(req,res){
//
//});
//module.exports = router;