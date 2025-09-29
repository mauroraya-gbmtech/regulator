const { exec } = require("child_process");
const util = require("util");

const execAsync = util.promisify(exec);

const processesMap = new Map();

const SAMPLES_INTERVAL = 60 * 1000;
const SAMPLES_LENGTH = 5;

const Status = {
	LOW: "LOW",
	BELOW_NORMAL: "BELOW_NORMAL",
	NORMAL: "NORMAL",
	ABOVE_NORMAL: "ABOVE_NORMAL",
	HIGH: "HIGH"
};

function detectSpike(samples) {
	const max = Math.max(...samples);
	const min = Math.min(...samples);

	if (max - min > 200 * 1024 * 1024) {
		return {
			status: Status.HIGH,
			message: `Uso de memória RAM teve um pico de ${(max - min) / (1024 * 1024)} MB`
		};
	}

	return {
		status: Status.NORMAL,
		message: `Nenhum pico de memória RAM detectado`
	};
}

function detectTrend(samples) {
	const first = samples[0];
	const last = samples[samples.length - 1];

	const slope = (last - first) / first;

	if (slope > 0.5) {
		return {
			status: Status.ABOVE_NORMAL,
			message: `Uso de memória RAM aumentou em ${(slope * 100).toFixed(1)}%`
		};
	}

	return {
		status: Status.NORMAL,
		message: `Nenhuma tendência de aumento de memória RAM detectado`
	};
}

async function actionNotifyClickUp(process, detectorType, status, actionResult) {
  const payload = {
    workSpaceId: process.env.CLICKUP_WORKSPACE_ID,
    channelId: process.env.CLICKUP_CHANNEL_ID,
    message: {
      processId: process.id,
      processName: process.name,
      detectorType,
      status,
      actions: {
        "stop-pm2": actionResult
      }
    }
  };

  try {
    const response = await fetch(process.env.CLICKUP_WEBHOOK_URL, {
      method: "POST",
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      console.error("Erro ao tentar criar mensagem no ClickUp");
    }
  } catch (err) {
    console.error("Erro ao tentar mandar mensagem para o ClickUp:", err);
  }
}

async function actionStopPM2Process(process) {
  try {
    await execAsync(`pm2 stop ${process.id}`);
    console.log(`Processo do PM2 ${process.name} foi parado com sucesso`);
    return "successfull";
  } catch (err) {
    console.error(`Erro ao tentar parar processo do PM2 ${process.name}:`, err);
    return "failed";
  }
}

function toMB(bytes) {
  return Math.round(bytes / 1024 / 1024);
}

async function getPM2Processes() {
  try {
    const { stdout } = await execAsync("pm2 jlist");
    const jsonStart = stdout.indexOf("[");

    if (jsonStart === -1) {
      throw new Error("Não foi possível encontrar uma saída JSON do comando 'pm2 jlist'");
    }

    const processes = JSON.parse(stdout.slice(jsonStart));

    return processes.map(process => ({
      id: process.pm_id,
      name: process.name,
      memory: toMB(process.monit.memory)
    }));
  } catch (err) {
    console.error("Erro ao tentar ler os processos do PM2:", err);
    return [];
  }
}

async function monitorProcesses() {
  const processesList = await getPM2Processes();

  for (const process of processesList) {
    if (!processesMap.has(process.id)) {
      processesMap.set(process.id, {
        name: process.name,
        samples: []
      });
    }

    const entry = processesMap.get(process.id);

    entry.samples.push(process.memory);

    if (entry.samples.length > SAMPLES_LENGTH) {
      entry.samples.shift();
    }

    const spikeResult = detectSpike(entry.samples);
    const trendResult = detectTrend(entry.samples);

    console.log(`${process.id} - ${process.name} - [${entry.samples}] - SPIKE: ${spikeResult.status} - TREND: ${trendResult.status}`);

    if (spikeResult.status === Status.HIGH) {
      const stopResult = await actionStopPM2Process(process);
      await actionNotifyClickUp(process, "spike", spikeResult.status, stopResult);
    }

    if (trendResult.status === Status.ABOVE_NORMAL) {
      await actionNotifyClickUp(process, "trend", trendResult.status, "no action");
    }
  }
}

console.log("Começando regulação dos processos PM2")
monitorProcesses();

setInterval(() => {
  monitorProcesses();
}, SAMPLES_INTERVAL);
