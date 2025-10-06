const clickUp = require("./.api/apis/clickup");

const { exec } = require("child_process");
const util = require("util");

const execAsync = util.promisify(exec);

const SAMPLES_INTERVAL = 30 * 1000;
const SAMPLES_LENGTH = 5;

const CLICKUP_CREATE_MESSAGE_COOLDOWN = SAMPLES_LENGTH * SAMPLES_INTERVAL; 

const map = new Map();

/**
 * @param {number[]} samples - List of data collected over time series
 * @param {String} type - Type of data collected (CPU Usage, RAM...)
 * @param {number} threshold - Threshold value in MB to trigger the detection
 * @param {String[]} messages - List of messages for the plataform notification
 * @returns {String}
 */
function detectSpike(samples, type, threshold, messages) {
  const max = Math.max(...samples);
  const min = Math.min(...samples);

  const diff = max - min;

  if (diff > threshold) {
    messages.push(`🔊 Uso de ${type} teve um pico de ${diff} MB`);
    return "HIGH";
  }

  return "NORMAL";
}

/**
 * @param {number[]} samples - List of data collected over time series
 * @param {String} type - Type of data collected (CPU Usage, RAM...)
 * @param {number} threshold - Threshold value in MB to trigger the detection
 * @param {String[]} messages - List of messages for the plataform notification
 * @returns {String}
 */
function detectTrend(samples, type, threshold, messages) {
  const first = samples[0];
  const last = samples[samples.length - 1];

  const slope = last - first;

  if (slope > threshold) {
    messages.push(`🔊 Uso de ${type} aumentou em ${slope} MB`);
    return "ABOVE_NORMAL";
  }

  return "NORMAL";
}

/**
 * @param {Object} _process 
 * @param {String[]} messages 
 * @returns {String}
 */
async function actionRestartPM2Process(_process, messages) {
  if (!_process.id) {
    messages.push(`❌ Erro, ID do processo do PM2 ${_process.name} indefinido`);
    return "FAILURE";
  }

  try {
    await execAsync(`pm2 restart ${_process.id}`);

    messages.push(`✅ Processo do PM2 ${_process.name} foi parado com sucesso`);
    return "SUCCESS";
  } catch (err) {
    messages.push(`❌ Erro ao tentar parar processo do PM2 ${_process.name}`);
    return "FAILURE";
  }
}

/**
 * @param {String} message 
 */
async function createChatMessageClickUp(message) {
  /** @type {CreateChatMessageBodyParam} */
  const body = {
    type: "message",
    content_format: "text/md",
    content: message
  };

  /** @type {CreateChatMessageMetadataParam} */
  const metadata = {
    workspace_id: process.env.CLICKUP_WORKSPACE_ID,
    channel_id: process.env.CLICKUP_CHANNEL_ID
  };

  try {
    const response = await clickUp.createChatMessage(body, metadata);
    
    if (!response.res.ok) {
      console.error("Erro ao tentar enviar mensagem para o ClickUp");
    }
  } catch (err) {
    console.error(`Erro inesperado ao tentar enviar mensagem para o ClickUp: ${err.message}`);
  }
}

function toMB(bytes) {
  return Math.round(bytes / 1024 / 1024);
}

/**
 * @returns {Promise<Object[]>}
 */
async function getPM2Processes() {
  try {
    const { stdout } = await execAsync("pm2 jlist");
    const jsonStart = stdout.indexOf("[");

    if (jsonStart === -1) {
      throw new Error("Não foi possível encontrar uma saída JSON do comando 'pm2 jlist'");
    }

    const processes = JSON.parse(stdout.slice(jsonStart));

    return processes.map(_process => ({
      id: _process.pm_id,
      name: _process.name,
      memory: toMB(_process.monit.memory),
    }));
  } catch (err) {
    console.error("Erro ao tentar ler os processos do PM2:", err);
    return [];
  }
}

async function regulate() {
  const processes = await getPM2Processes();
  const messages = [];

  for (const _process of processes) {
    if (!map.has(_process.id)) {
      map.set(_process.id, { 
        name: _process.name, 
        samples: [],
        timestamp: Date.now()
      });
    }

    const entry = map.get(_process.id);

    entry.samples.push(_process.memory);

    if (entry.samples.length > SAMPLES_LENGTH) {
      entry.samples.shift();
    }

    const results = [
      detectSpike(entry.samples, "RAM", 200, messages),
      detectTrend(entry.samples, "RAM", 50, messages)
    ];

    for (const result of results) {
      if (
        result === "BELOW_NORMAL" ||
        result === "LOW" ||
        result === "NORMAL"
      ) continue;

      if (result === "HIGH") {
        await actionRestartPM2Process(_process, messages);
      }

      messages.unshift(`🔎 ${_process.name}`);
      const message = messages.join("\n");

      const now = Date.now();

      if (now - entry.timestamp < CLICKUP_CREATE_MESSAGE_COOLDOWN) {
        continue;
      }

      await createChatMessageClickUp(message);
      entry.timestamp = now;

      messages.length = 0;
    }

    console.log(`[${_process.id}] - ${_process.name} - [${entry.samples}] - ${results}`);
  }

  console.log();
}

async function main() {
  clickUp.auth(process.env.CLICKUP_API_KEY);

  console.log(`Regulando processos do PM2 a cada ${SAMPLES_INTERVAL / 1000}s`);
  await regulate();

  setInterval(async () => {
    await regulate();
  }, SAMPLES_INTERVAL);
}

main();
