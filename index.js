#!/usr/bin/env node
'use strict';

const path = require('path');
const notifier = require('node-notifier');
const progress = require('progress');
const colors = require('colors');
const program = require('commander');
const EventEmitter = require('events');
const request = require('request');
const pomodoro = require('./models/pomodoro');
const mqtt = require('mqtt');
const {  MQTT_URL, MQTT_USER, MQTT_PASS, GALILEO_PORT, TOPIC_PREFIX } = require('./config');

program
  .version('0.0.4')
  .usage('Pomodoro cli - a simple pomodoro for terminal')
  .option('-s, --shortbreak', 'Add short break timer')
  .option('-l, --longbreak', 'Add long break timer')
  .option('-t, --timer <time>', 'Add specific time in minutes', parseInt)
  .option('-a, --add-task <task>', 'Add a new task', 'task')
  .parse(process.argv);



const mqttClient = mqtt.connect(MQTT_URL);
const user_hash = `${MQTT_USER}:${MQTT_PASS}:${GALILEO_PORT}`;
const mqttPublish = (topic, message, cb) => mqttClient.publish(topic, message, { qos: 2 }, cb);

const pomodoroEmitter = new EventEmitter();

var slackInterval = null;
var bar = null;

var slackStatus = function() {
  var data = {
    "token": "",
    "profile": JSON.stringify({
      "status_text": "Busy, Avaliable in " + Math.floor((bar.total - bar.curr)/61) + " Minutes",
      "status_emoji": ":red_circle:"
    })
  };
  request.post('https://slack.com/api/users.profile.set', {form: data});
};

var slackStatusAvailable = function() {
  var data = {
    "token": "",
    "profile": JSON.stringify({
      "status_text": "Available",
      "status_emoji": ":large_blue_circle:"
    })
  };
  request.post('https://slack.com/api/users.profile.set', {form: data}, () => {process.exit(0)});
};

process.on( "SIGINT", function() {
  console.log("Exiting...")
  pomodoroEmitter.emit("pomodoro-end");
} );

pomodoroEmitter.on("pomodoro-start", () => {
  mqttPublish(`${TOPIC_PREFIX}/join`, user_hash);
  mqttPublish(`${TOPIC_PREFIX}/${user_hash}`, 'on');
  slackStatus();
  slackInterval = setInterval(slackStatus, 60 * 1000);
});

pomodoroEmitter.on("pomodoro-end", () => {
  mqttPublish(`${TOPIC_PREFIX}/leave`, user_hash, () => {
    mqttClient.end();
  });

  if (slackInterval) {
    clearInterval(slackInterval);
  }

  slackStatusAvailable();
});


const init = () => {
  let pomodoroConfig = {};

  pomodoroConfig = getTimeToPomodoro();

  pomodoro.setTimer(pomodoroConfig.time, 'minutes');
  pomodoro.setMessage(pomodoroConfig.message);

  bar = new progress(':timerFrom [:bar] :timerTo'.red, {
    complete: '=',
    incomplete: ' ',
    width: 50,
    total: pomodoro.totalSeconds(),
    timerTo: pomodoro.getTime('timerTo'),
    timerFrom: pomodoro.getTime('timerFrom'),
    callback: notify
  });

  pomodoroEmitter.emit("pomodoro-start");
  setInterval(() => {
    tick(bar);
  },1000);
};

const getTimeToPomodoro = () => {
  let pomodoroConfig = {};

  if(program.shortbreak) {
    pomodoroConfig.time = 5;
    pomodoroConfig.message = 'Let\'s get back to work!';
  } else if(program.longbreak) {
    pomodoroConfig.time = 10;
    pomodoroConfig.message = 'Let\'s get back to work! What you\'ve been doing?';
  } else if(program.timer) {
    pomodoroConfig.time = program.timer;
    pomodoroConfig.message = 'Time\'s up! What you\'re gonna do next?';
  } else {
    pomodoroConfig.time = 25;
    pomodoroConfig.message = 'Go ahead, take a break, you earned it!';
  }

  return pomodoroConfig;
};

const tick = (bar) => {
  bar.tick(1, {
    timerFrom: pomodoro.getTime('timerFrom'),
    timerTo: pomodoro.getTime('timerTo')
  });

  pomodoro.tick();
};

const notify = () => {
  notifier.notify({
    title: 'Pomodoro Cli',
    message: pomodoro.getMessage(),
    icon: path.join(__dirname, 'images/pomodoro.png'),
    sound: 'true',
  });

  pomodoroEmitter.emit("pomodoro-end");
};

init();
