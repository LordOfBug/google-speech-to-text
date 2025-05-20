# Google Speech API Testing Project Setup

This guide will help you set up and run the Google Speech API testing project.

## Prerequisites

- Node.js installed
- Access to a local proxy (http://127.0.0.1:8888) for accessing Google's services
- A valid Google Cloud API key with Speech-to-Text API enabled

## Setup Instructions

1. **Install dependencies**

```bash
cd @speech/backend
npm install
```

2. **Start the server**

```bash
cd @speech/backend
node server.js
```

The server will start on port 3000 by default. You should see output like:

```
Proxy server running on port 3000
Using proxy: http://127.0.0.1:8888
```

3. **Access the web interface**

Open your browser and navigate to:
```
http://localhost:3000
```

## Troubleshooting Common Issues

### 400 Bad Request

If you see a 400 Bad Request error, it usually means:

1. The request format is incorrect for the API version you're using
2. The audio format is not supported (the server now sets encoding to LINEAR16 and sample rate to 16000Hz)

### API Key Issues

Make sure your API key:
- Has Speech-to-Text API enabled in Google Cloud Console
- For V2 API: Has Speech-to-Text V2 API specifically enabled
- Has no restrictions that would prevent it from being used from your IP address

### Proxy Issues

If you're having trouble with the proxy:
- Verify that your local proxy at http://127.0.0.1:8888 is running
- Check if the proxy allows HTTPS connections to Google's APIs

## Debug Mode

Turn on Debug Mode in the interface to see:
- Exact request format being sent
- Complete response from the API
- Any error messages

This will help identify what might be wrong with your requests.

## API Versions

### V1 API
- More widely supported
- Works with most API keys
- Requires specific audio format information

### V2 API
- Newer models like Chirp and Chirp 2
- Might require specific API permissions
- Different request format

## Testing Different Models

Try different models to see which works best for your use case:
- V1: default, command_and_search, phone_call, video
- V2: chirp, chirp_2, telephony, medical_dictation
