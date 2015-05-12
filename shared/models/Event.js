var mongoose = require('mongoose');

// Create a new schema for our tweet data
var schema = new mongoose.Schema({
    eventTime           : Date
  , body       : [{}]
  , routingKey    : String
  , createdAt   : { type: Date, default: Date.now }
});

// Static methods
schema.statics.registerEvent = function(eventTime,body,routingKey,callback) {
  var promise = new mongoose.Promise;
  if(callback) promise.addBack(callback);

   Event (
  {
    eventTime: eventTime,
      body: body,
      routingKey: routingKey
  }).save(function(err, doc){
    
       if (err) {
      promise.error(err);
      return;
    } 
    promise.complete(doc);
  });
  }


schema.statics.getLatestEvent = function(callback) {
  var promise = new mongoose.Promise;
  if(callback) promise.addBack(callback);


  Event.findOne({ "$query":{}, "$orderby":{ "eventDate": 1 }}).exec( function(err, doc) {
     if (err) {
      promise.error(err);
      return;
    } 
    promise.complete(doc);
  });
 
  return promise;
}



schema.statics.getEvents = function(eventTime, callback) {
  var promise = new mongoose.Promise;
  if(callback) promise.addBack(callback);

  Event.find({'eventTime' : eventTime }).exec( function(err, docs) {
     if (err) {
      promise.error(err);
      return;
    } 
    promise.complete(docs);
  });
 
  return promise;

}



// Return a Scheduler model based upon the defined schema
module.exports = Event = mongoose.model('events', schema);


