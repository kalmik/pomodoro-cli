#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const notifier = require('node-notifier');
const progress = require('progress');
const colors = require('colors');
const program = require('commander');
const EventEmitter = require('events');
const request = require('request');
const pomodoro = require('./models/pomodoro');
const mqtt = require('mqtt');
const {  MQTT_URL, MQTT_USER, MQTT_PASS, GALILEO_PORT, TOPIC_PREFIX, SLACK_TOKEN, TASKS_PATH } = require('./config');

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

const day_path = TASKS_PATH + new Date().toLocaleDateString().replace(/\//g, '-') + ".txt";

var slackInterval = null;
var bar = null;

var slackStatus = function() {
  var data = {
    "token": SLACK_TOKEN,
    "profile": JSON.stringify({
      "status_text": "Busy, Avaliable in " + Math.floor((bar.total - bar.curr)/61) + " Minutes - " + pomodoro.getMessage(),
      "status_emoji": ":red_circle:"
    })
  };
  request.post('https://slack.com/api/users.profile.set', {form: data});
};

var slackStatusAvailable = function() {
  var data = {
    "token": SLACK_TOKEN,
    "profile": JSON.stringify({
      "status_text": "Available",
      "status_emoji": ":large_blue_circle:"
    })
  };
  request.post('https://slack.com/api/users.profile.set', {form: data}, () => {process.exit(0)});
  var data = {
    "token": SLACK_TOKEN,
  }
  request.post('https://slack.com/api/dnd.endSnooze', {form: data})
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
  var data = {
    "token": SLACK_TOKEN,
    "num_minutes": Math.floor(bar.total/61)
  }
  request.post('https://slack.com/api/dnd.setSnooze', {form: data})
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

const addTask = (task) => {

let buffer = new Buffer(new Date().toLocaleTimeString() + " " + task + "\n");

// open the file in writing mode, adding a callback function where we do the actual writing
fs.open(day_path, 'a+', function(err, fd) {
    if (err) {
        throw 'could not open file: ' + err;
    }

    // write the contents of the buffer, from position 0 to the end, to the file descriptor returned in opening our file
    fs.write(fd, buffer, 0, buffer.length, null, function(err) {
        if (err) throw 'error writing file: ' + err;
        fs.close(fd);
    });
});
}

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
  if(program.addTask) {
    pomodoroConfig.message = program.addTask;
    addTask(program.addTask);
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
