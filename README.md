# Voice Agent Test Script

A tool for automated testing of voice agents using predefined test cases executed through phone calls.

## Overview

This project provides a script for running automated tests against voice agents. It allows you to define test cases in a CSV file, make real phone calls to test voice agents, evaluate the interactions, and output the results to a CSV file.

## Features

- Run multiple test scenarios defined in CSV files
- Execute concurrent calls to test voice agents
- Use OpenAI's GPT models to simulate caller behavior
- Transcribe and analyze call recordings
- Generate detailed test reports as CSV

## Requirements

- Node.js
- TypeScript
- Vapi.ai account and API key
- OpenAI API key
- Deepgram API key

## Setup

1. Clone this repository
2. Install dependencies:
   ```
   npm install
   ```
3. Set up environment variables in a `.env` file:
   ```
   VAPI_API_KEY=your_vapi_api_key
   VAPI_NUMBER_ID=your_vapi_number_id
   OPENAI_API_KEY=your_openai_api_key
   DEEPGRAM_API_KEY=your_deepgram_api_key
   ```

## Usage

1. Create a CSV file with test cases in the following format (an example `my_test.csv` is provided in the repo):
   ```
   ID,Number,Title,Instruction,NumTest,Test1,Test2,...
   1,+11234567890,Test Title,Test instruction for the voice agent,1,Expected behavior 1,...
   ```

2. Run the script:
   ```
   npx ts-node test-voice-agent.ts my_test.csv
   ```

3. Review the generated `my_test_out.csv` file for test results.

## CSV Columns

- **ID**: Unique identifier for the test
- **Number**: Phone number to call
- **Title**: Title of the test
- **Instruction**: Instructions for the assistant making the call
- **NumTest**: Number of test iterations to run
- **Test1, Test2, etc.**: Test criteria to evaluate

## License

[Your license information here]
