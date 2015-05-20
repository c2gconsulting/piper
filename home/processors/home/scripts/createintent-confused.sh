#!/usr/bin/env bash
curl -XPOST 'https://api.wit.ai/intents?v=20141022' \
  -H "Authorization: Bearer QJKD3F66M5PUDUCYVUHS6QQ5HYVUJUWT" \
  -H "Content-Type: application/json" \
  -d '{"name":"default_confused",
       "doc":"Confused",
       "expressions":[{
          "body" : "??"
        }, {
         "body" : "?"
        }, {
          "body" : "pardon?"
        }, {
          "body" : "excuse me?"
        }, {
          "body" : "sorry, what?"
        }, {
          "body" : "sorry?"
        }, {
          "body" : "what?"
        }, {
          "body" : "i dont get"
        }, {
         "body" : "what do you mean?"
        }, {
         "body" : "huh?"
        }]}'