var mongoose = require('mongoose');

// Create a new schema for our data
var schema = new mongoose.Schema({
    eventTime           : Date
  , body                : String
  , routingKey          : String
  , owner               : String
});


// Static methods
schema.statics.createEvent = function(eventTime, body, routingKey, owner, callback) {
  var promise = new mongoose.Promise;
  if(callback) promise.addBack(callback);

  Event.create({ 'eventTime': eventTime, 'body': body, 'routingKey': routingKey, 'owner': owner }, function(err, doc) {
    if (err) {
      promise.error(err);
      return;
    }
    promise.complete(doc);
  });
  
  return promise;

};


schema.statics.getEventByID = function(eventId, callback) {
  var promise = new mongoose.Promise;
  if(callback) promise.addBack(callback);

  Event.findOne({ '_id' : eventId }).exec( function(err, doc) {
    if (err) {
      promise.error(err);
      return;
    } 
    promise.complete(doc);
  });
  
  return promise;

};

schema.statics.getEventsByOwner = function(owner, callback) {
  var promise = new mongoose.Promise;
  if(callback) promise.addBack(callback);

  Event.find({ 'owner' : owner }).exec( function(err, docs) {
    if (err) {
      promise.error(err);
      return;
    } 
    promise.complete(docs);
  });
  
  return promise;

};

schema.statics.getDueEvents = function(eventTime, callback) {
  var promise = new mongoose.Promise;
  if(callback) promise.addBack(callback);

  Event.find({ 'eventTime': { $lt: eventTime }}).exec( function(err, docs) {
    if (err) {
      promise.error(err);
      return;
    } 
    promise.complete(docs);
  });
  
  return promise;

};

schema.statics.removeEvent = function(eventId, callback) {
  var promise = new mongoose.Promise;
  if(callback) promise.addBack(callback);

  Event.remove({ '_id': eventId }, function(err, docs) {
    if (err) {
      promise.error(err);
      return;
    } 
    promise.complete(docs);
  });
  
  return promise;

};


schema.statics.removeDueEvents = function(eventTime, callback) {
  var promise = new mongoose.Promise;
  if(callback) promise.addBack(callback);

  Event.remove({ 'eventTime': { $lt: eventTime }}, function(err, docs) {
    if (err) {
      promise.error(err);
      return;
    } 
    promise.complete(docs);
  });
  
  return promise;

};



// Return an Event model based upon the defined schema
module.exports = Event = mongoose.model('events', schema);


