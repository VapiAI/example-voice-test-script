// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
// eslint-disable-next-line @typescript-eslint/no-var-requires
require("@dotenvx/dotenvx").config();
import { parse } from "csv-parse";
import { readFileSync } from "fs";
import { VapiClient } from "@vapi-ai/server-sdk";
import { Liquid } from "liquidjs";
import { OpenAI } from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { z } from "zod";
import { createObjectCsvWriter } from "csv-writer";
import { createClient } from "@deepgram/sdk";

// the vapi account/number for the test caller
const VAPI_API_KEY = process.env.VAPI_API_KEY || "";
const VAPI_NUMBER_ID = process.env.VAPI_NUMBER_ID || "";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY || "";

const vapiClient = new VapiClient({
  token: VAPI_API_KEY,
});

const openaiClient = new OpenAI({
  apiKey: OPENAI_API_KEY,
});

const deepgram = createClient(DEEPGRAM_API_KEY);

const engine = new Liquid();

interface TestRecord {
  id: string;
  number: string;
  title: string;
  instruction: string;
  numtest: string;
  [key: string]: string; // For dynamic test fields (test1, test2, etc.)
}

// Add language configuration mapping
const languageConfigs = {
  en: {
    voice: {
      voiceId: '9BWtsMINqrJLrRacOk9x', // English voice
    },
    transcriber: {
      language: 'en',
    },
    endCallPhrases: ['goodbye', 'bye'],
  },
  es: {
    voice: {
      voiceId: 'TxGEqnHWrfWFTfGW9XjX', // Spanish voice
    },
    transcriber: {
      language: 'es',
    },
    endCallPhrases: ['adiós', 'chao', 'hasta luego'],
  },
  pt: {
    voice: {
      voiceId: 'NGS0ZsC7j4t4dCWbPdgO', // Portuguese voice
    },
    transcriber: {
      language: 'pt',
    },
    endCallPhrases: ['tchau', 'adeus', 'até mais', 'até logo', 'até breve'],
  },
} as const;

type SupportedLanguage = keyof typeof languageConfigs;

const main = async () => {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.error("Usage: npx ts-node test-voice-agent.ts <inputCsvPath> [language]");
    console.error("Supported languages: en (English), es (Spanish), pt (Portuguese)");
    process.exit(1);
  }
  const [inputCsvPath, language = 'en'] = args;

  if (!Object.keys(languageConfigs).includes(language)) {
    console.error(`Unsupported language: ${language}`);
    console.error("Supported languages: en (English), es (Spanish), pt (Portuguese)");
    process.exit(1);
  }

  // Extract the filename without path and extension
  const inputFileName =
    inputCsvPath.split("/").pop()?.replace(".csv", "") || "";
  // Generate output path in the same directory as input
  const outputCsvPath = inputCsvPath.replace(
    inputFileName + ".csv",
    `${inputFileName}_out.csv`
  );

  // Read file content
  const fileContent = readFileSync(inputCsvPath, "utf-8");

  // Parse CSV content synchronously
  const records = await new Promise<any[]>((resolve, reject) => {
    parse(
      fileContent,
      {
        delimiter: ",",
        columns: true,
      },
      (err, data) => {
        if (err) {
          reject(err);
        }
        // Transform the data to lowercase keys and cast to TestRecord
        const transformedData = data.map((record): TestRecord => {
          return Object.fromEntries(
            Object.entries(record).map(([key, value]) => [
              key.toLowerCase(),
              value,
            ])
          ) as TestRecord;
        });
        resolve(transformedData);
      }
    );
  });

  console.log("records: ", records);
  // Run all records in parallel, each record running its tests in parallel
  const allResultsArrays = await Promise.all(
    records.map(async (record) => {
      console.log("running test for ", record.id);
      return runTests(record, language as SupportedLanguage);
    })
  );

  // Flatten results from all records
  const allResults = allResultsArrays.flat();

  // Write results to CSV
  const csvWriter = createObjectCsvWriter({
    path: outputCsvPath,
    header: [
      { id: "id", title: "ID" },
      { id: "passed", title: "Passed" },
      { id: "reasoning", title: "Reasoning" },
      { id: "transcript", title: "Transcript" },
      { id: "instruction", title: "Instruction" },
      { id: "test", title: "Test" },
      { id: "title", title: "Title" },
      { id: "number", title: "Number" },
      { id: "callID", title: "CallID" },
      { id: "recording_url", title: "Recording URL" },
      { id: "receiver_call_id", title: "Receiver Call ID" },
    ],
  });
  await csvWriter.writeRecords(allResults);
  console.log(`Results written to ${outputCsvPath}`);
};

interface TestResultRow {
  id: string;
  number: string;
  title: string;
  instruction: string;
  test: string;
  passed: boolean;
  reasoning: string;
  callID: string;
  transcript: string;
  recording_url: string;
  phoneCallProviderId: string;
  receiver_call_id: string;
}

const ASSISTANT_PROMPT_TEMPLATE = `
You are a phone call test assistant that will help the customer test their custom voice agent. 

You will be given a set of instructions on how to interact with another voice agent in order to test it. Please follow your instruction exactly.
The instructions may be in a different language than english. Please speak in the language of the instructions.

Here is the instruction, please follow it exactly:
{{ instruction }}

When you want to hang up the call, please say "goodbye" or "bye", in the language of the call.
`;

const runTest = async (
  testRecord: TestRecord,
  iteration: number,
  numTests: number,
  language: SupportedLanguage = 'en'
): Promise<TestResultRow[]> => {
  console.log(`Running test iteration ${iteration + 1}/${numTests}`);
  const testResults: TestResultRow[] = [];

  const response = await vapiClient.calls.create({
    phoneNumberId: VAPI_NUMBER_ID,
    customer: {
      number: testRecord.number,
    },
    assistant: {
      model: {
        provider: "openai",
        model: "gpt-4o-2024-11-20",
        messages: [
          {
            role: "system",
            content: engine.parseAndRenderSync(ASSISTANT_PROMPT_TEMPLATE, {
              instruction: testRecord.instruction,
            }),
          },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "endCall",
            },
          },
        ],
      },
      startSpeakingPlan: {
        waitSeconds: 2,
      },
      voice: {
        provider: "11labs",
        model: "eleven_multilingual_v2",
        ...languageConfigs[language].voice,
      },
      transcriber: {
        provider: "deepgram",
        model: "nova-2",
        ...languageConfigs[language].transcriber,
      },
      endCallPhrases: languageConfigs[language].endCallPhrases,
      backgroundSound: "off",
    },
  });

  const callID = response.id;

  let callCompleted = false;
  const max_failed_allowed_attempts = 10;
  while (!callCompleted) {
    try {
      const call = await vapiClient.calls.get(callID);
      if (call.status === "ended") {
        callCompleted = true;
        console.log("call ended");
        console.log(call);

        const transcription = await deepgram.listen.prerecorded.transcribeUrl(
          {
            url: call.artifact?.stereoRecordingUrl,
          },
          {
            model: "nova-2",
            detect_language: true,
            multichannel: true,
          }
        );

        const formattedTranscript = formatDualChannelTranscript(transcription);
        const analysis = await analyzeCall(testRecord, formattedTranscript);

        // Generate test result records for each test case
        for (const [testKey, result] of Object.entries(analysis.results)) {
          testResults.push({
            id: testRecord.id,
            number: testRecord.number,
            title: testRecord.title,
            instruction: testRecord.instruction,
            test: testRecord[testKey as keyof TestRecord] || "",
            passed: result.passed,
            reasoning: result.reasoning,
            callID,
            // @ts-expect-error wrong type
            transcript: formattedTranscript,
            // @ts-expect-error wrong type
            recording_url: call.artifact?.recordingUrl,
            phoneCallProviderId: call.phoneCallProviderId,
          });
        }

        console.log(`Test iteration ${iteration + 1} results:`, analysis);
      } else {
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    } catch (error) {
      console.error("Error getting call: ", error);
      await new Promise((resolve) => setTimeout(resolve, 5000));
      if (failedAttempts >= max_failed_allowed_attempts) {
        console.error("Max failed attempts reached, aborting");
        break;
      }
      failedAttempts++;
    }
  }

  console.log("test results: ", testResults);

  return testResults;
};

const runTests = async (testRecord: TestRecord, language: SupportedLanguage = 'en') => {
  const numTests = parseInt(testRecord.numtest);

  // Run all tests in parallel
  const testPromises = Array.from({ length: numTests }, (_, i) =>
    runTest(testRecord, i, numTests, language)
  );

  const testResultArrays = await Promise.all(testPromises);

  // Flatten the array of test results
  return testResultArrays.flat();
};

const formatDualChannelTranscript = (transcription: any): string => {
  console.log("formatting dual channel transcript");
  console.log("transcription: ", JSON.stringify(transcription, null, 2));

  // Check if we have valid channels data
  if (!transcription?.result?.results?.channels?.length) {
    console.warn("No channel data found in transcription");
    return "No transcript available";
  }

  // Channel 0 is typically the AI/Assistant
  const aiChannel = transcription.result.results.channels[0];
  // Channel 1 is typically the User
  const userChannel = transcription.result.results.channels[1];

  // Verify we have valid channel data
  if (
    !aiChannel?.alternatives?.[0]?.words ||
    !userChannel?.alternatives?.[0]?.words
  ) {
    console.warn("Invalid channel data structure");
    return "Invalid transcript data";
  }

  // Combine all utterances with timestamps into a single array
  const allUtterances = [
    ...aiChannel.alternatives[0].words.map((word: any) => ({
      text: word.word,
      start: word.start,
      speaker: "AI",
    })),
    ...userChannel.alternatives[0].words.map((word: any) => ({
      text: word.word,
      start: word.start,
      speaker: "User",
    })),
  ];

  // Sort by timestamp
  allUtterances.sort((a, b) => a.start - b.start);

  // Group words by speaker
  let currentSpeaker = "";
  let currentUtterance = "";
  const conversationLines: string[] = [];

  allUtterances.forEach((utterance) => {
    if (currentSpeaker !== utterance.speaker) {
      if (currentUtterance) {
        conversationLines.push(`${currentSpeaker}: ${currentUtterance.trim()}`);
      }
      currentSpeaker = utterance.speaker;
      currentUtterance = utterance.text;
    } else {
      currentUtterance += " " + utterance.text;
    }
  });

  // Add the last utterance
  if (currentUtterance) {
    conversationLines.push(`${currentSpeaker}: ${currentUtterance.trim()}`);
  }

  return conversationLines.join("\n");
};

interface CallAnalysis {
  results: {
    [key: string]: {
      passed: boolean;
      message: string;
    };
  };
}

const analyzeCall = async (
  testRecord: TestRecord,
  formattedTranscript: string
): Promise<CallAnalysis> => {
  const analysis: CallAnalysis = {
    results: {},
  };

  // Get all test keys (test1, test2, etc) from testRecord
  const testKeys = Object.keys(testRecord).filter((key) =>
    key.startsWith("test")
  );

  // Run each test through LLM judge
  for (const testKey of testKeys) {
    const testCase = testRecord[testKey as keyof TestRecord];
    if (!testCase) {
      continue;
    }

    const judgement = await llm_as_judge(testCase, formattedTranscript);
    analysis.results[testKey] = {
      passed: judgement.passed,
      reasoning: judgement.reasoning,
    };
  }

  return analysis;
};

const LLMJudgeResponse = z.object({
  passed: z.boolean(),
  reasoning: z.string(),
});

const llm_as_judge = async (
  testInstructions: string,
  transcript: string
): Promise<z.infer<typeof LLMJudgeResponse>> => {
  const prompt = `
  You are a judge that will analyze a call and determine if the call passed or failed. You are analyzing the behavior of "USER" from the call transcript.
  Note, the instructions and transcript may be in a different language than english. Use your multilingual capabilities to understand the call.

  Here is the test instructions:
  {{ test }}

  Here is the call transcript:
  {{ transcript }}


  Return a JSON object with the following fields:
  - passed: boolean <-- this denote whether the test passed or failed
  - reasoning: string <-- this is a message that will be displayed to the user, explain your reasoning on why the test passed or failed
  `;
  const response = await openaiClient.beta.chat.completions.parse({
    model: "gpt-4o-2024-11-20",
    messages: [
      {
        role: "system",
        content: engine.parseAndRenderSync(prompt, {
          test: testInstructions,
          transcript: transcript,
        }),
        temperature: 0,
      },
    ],
    response_format: zodResponseFormat(LLMJudgeResponse, "judge_response"),
  });

  return response.choices[0].message.parsed || { passed: false, reasoning: "" };
};

void main().catch((error) => {
  console.error("Error running tests:", error);
  process.exit(1);
});
