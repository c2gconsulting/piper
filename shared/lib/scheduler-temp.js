
var Event = require('../models/Event');
var logger = require('./log');



function add(eventTime, body, routingKey) {
  var interval;
  if (typeof eventTime == Date && new Date() < eventTime) {
    return Event.registerEvent(eventTime, body, routingKey).then(function (doc) {
      logger.debug('Events Saved Successfully, Returning ID');
      if (doc) {
        logger.debug(doc._id);
        return Event.getLatestEvent().then(function (doc) {
          if (doc) {
            var latesteventtime = doc.eventTime.getTime();
            if (!interval) {
              interval = latesteventtime - new Date().getTime();
            } else {
              logger.debug("Interval picking the latest date");
            }
            setInterval(publishEvent, interval);
          } else {

            logger.debug("no latest events found");
          }
        });
      } else {

      }


    });
    return Event.getLatestEvent().then(function (doc) {
      if (doc) {
        var latesteventtime = doc.eventTime.getTime();
        interval = latesteventtime - new Date().getTime();
      } else {
        logger.debug("no latest events found");
      }

    });

  } else {
    logger.debug("Sorry Event is in the Past");
  }



  function publishEvent() {

    var nowDate = new Date().getTime();

    return Event.getEvents(nowDate).then(function (doc) {
      if (doc) {

        logger.debug(JSON.stringify(doc));
      } else {
        logger.debug("cannot find any event for now")
      }
    });

  }





// Export the Collection constructor from this module.
module.exports.scheduler = add;



