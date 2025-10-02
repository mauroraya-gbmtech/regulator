const clickUp = require("./.api/apis/clickup");

const { exec } = require("child_process");
const util = require("util");

const execAsync = util.promisify(exec);

const SAMPLES_INTERVAL = 30 * 1000;
const SAMPLES_LENGTH = 5;

const map = new Map();

/**
 * @param {number[]} samples - List of data collected over time series
 * @param {String} type - Type of data collected (CPU Usage, RAM...)
 * @param {number} threshold - Threshold value to trigger the detection
 * @param {String[]} messages - List of messages for the plataform notification
 * @returns {String}
 */
function detectSpike(samples, type, threshold, messages) {
  const max = Math.max(...samples);
  const min = Math.min(...samples);

  const diff = max - min;

  if (diff > threshold) {
    messages.push(`Uso de ${type} teve um pico de ${diff} MB`);
    return "HIGH";
  }

  messages.push(`Uso de ${type} teve um pico de ${diff} MB`);
  return "NORMAL";
}

/**
 * @param {number[]} samples - List of data collected over time series
 * @param {String} type - Type of data collected (CPU Usage, RAM...)
 * @param {number} threshold - Threshold value to trigger the detection
 * @param {String[]} messages - List of messages for the plataform notification
 * @returns {String}
 */
function detectTrend(samples, type, threshold, messages) {
  const first = samples[0];
  const last = samples[samples.length - 1];

  const slope = (last - first) / first;

  if (slope > threshold) {
    messages.push(`Uso de ${type} aumentou em ${(slope * 100).toFixed(1)}%`);
    return "ABOVE_NORMAL";
  }

  messages.push(`Nenhuma tendência de aumento de ${type} detectado`);
  return "NORMAL";
}

/**
 * @typedef {Object} PM2Process
 * @property {number} id
 * @property {string} name
 * @property {number} memory
 */

/**
 * @enum
 */
const Status = {
  SUCCESS: "SUCCESS",
  FAILURE: "FAILURE"
};

/**
 * @typedef {Object} ActionResult
 * @property {Status} status
 * @property {string} message
 */

/**
 * @param {PM2Process} pm2Process
 * @param {DetectionResult} result
 * @returns {Promise<ActionResult>}
 */
async function actionNotifyClickUp(pm2Process, result) {
  const message = [
    `⚙️ ${pm2Process.name}`,
    `🔊 ${result.message}`
  ].join('\n');

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

    if (!response.ok) {
      return {
        status: Status.FAILURE,
        message: "Erro ao tentar enviar mensagem para o ClickUp"
      };
    }

    return {
      status: Status.SUCCESS,
      message: "Mensagem enviada ao ClickUp com sucesso"
    };
  } catch (err) {
    return {
      status: Status.FAILURE,
      message: `Erro inesperado ao tentar enviar mensagem para o ClickUp: ${err.message}`
    };
  }
}

/**
 * @param {PM2Process} pm2Process
 * @param {DetectionResult} result
 * @returns {Promise<ActionResult>}
 */
async function actionStopPM2Process(pm2Process, result) {
  try {
    await execAsync(`pm2 stop ${pm2Process.id}`);

    return {
      status: Status.SUCCESS,
      message: `Processo do PM2 ${pm2Process.name} foi parado com sucesso`
    };
  } catch (err) {
    return {
      status: Status.FAILURE,
      message: `Erro ao tentar parar processo do PM2 ${pm2Process.name}`
    };
  }
}

function toMB(bytes) {
  return Math.round(bytes / 1024 / 1024);
}

/**
 * @returns {Promise<PM2Process[]>}
 */
async function getPM2Processes() {
  try {
    const { stdout } = await execAsync("pm2 jlist");
    const jsonStart = stdout.indexOf("[");

    if (jsonStart === -1) {
      throw new Error("Não foi possível encontrar uma saída JSON do comando 'pm2 jlist'");
    }

    const pm2ProcessesList = JSON.parse(stdout.slice(jsonStart));

    return pm2ProcessesList.map(pm2Process => ({
      id: pm2Process.pm_id,
      name: pm2Process.name,
      memory: toMB(pm2Process.monit.memory)
    }));
  } catch (err) {
    console.error("Erro ao tentar ler os processos do PM2:", err);
    return [];
  }
}

const rules = {
  [Usage.HIGH]: [
    actionNotifyClickUp,
    actionStopPM2Process,
  ],
  [Usage.ABOVE_NORMAL]: [
    actionNotifyClickUp
  ]
};

async function regulatePM2Processes() {
  const pm2ProcessesList = await getPM2Processes();

  for (const pm2Process of pm2ProcessesList) {
    if (!pm2ProcessesMap.has(pm2Process.id)) {
      pm2ProcessesMap.set(pm2Process.id, { name: pm2Process.name, samples: [] });
    }

    const entry = pm2ProcessesMap.get(pm2Process.id);

    //teste
    if (
      entry.samples.length === 0 &&
      pm2Process.id === 20
    ) {
      entry.samples.push(300);
    } else {
      entry.samples.push(pm2Process.memory);
    }

    if (entry.samples.length > SAMPLES_LENGTH) {
      entry.samples.shift();
    }

    const detectionResults = [
      detectSpike(entry.samples), 
      detectTrend(entry.samples)
    ];

    for (const detectionResult of detectionResults) {
      const actions = rules[detectionResult.status] ?? [];

      actions.length > 0 && console.log(actions);

      for (const action of actions) {
        const actionResult = await action(pm2Process, detectionResult);
        console.log(actionResult);
      }
    }
  }
}

async function main() {
  clickUp.auth(process.env.CLICKUP_API_KEY);

  console.log(`Regulando processos PM2 a cada ${SAMPLES_INTERVAL / 1000}s`);
  await regulatePM2Processes();

  setInterval(async () => {
    await regulatePM2Processes();
  }, SAMPLES_INTERVAL);
}

main();



// get pm2 processes

// store them in a map

// messages = []

// detection -> message, Usage

// for detection 