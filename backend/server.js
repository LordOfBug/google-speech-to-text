const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const bodyParser = require('body-parser');
const cors = require('cors');
const multer = require('multer');
const { GoogleAuth } = require('google-auth-library');
const { HttpsProxyAgent } = require('https-proxy-agent');
const dotenv = require('dotenv');
const { Readable } = require('stream');
const ffmpeg = require('fluent-ffmpeg');
const speech = require('@google-cloud/speech');

// Load environment variables from .env and .env.local files
// First load the default .env file
dotenv.config();

// Then load .env.local if it exists (will override values from .env)
const envLocalPath = path.resolve(__dirname, '.env.local');
if (fs.existsSync(envLocalPath)) {
  const envLocalConfig = dotenv.parse(fs.readFileSync(envLocalPath));
  for (const k in envLocalConfig) {
    process.env[k] = envLocalConfig[k];
  }
  console.log('Loaded environment variables from .env.local');
}

// Define uploads directory with absolute path
const uploadsDir = path.join(__dirname, 'uploads');

// Create uploads directory if it doesn't exist
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

// Log the uploads directory path for debugging
console.log(`Uploads directory: ${uploadsDir}`);

const app = express();
const upload = multer({ dest: uploadsDir });

// Enable CORS
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Configure proxy agent for requests behind firewall
const useProxy = process.env.USE_PROXY === 'true';
const proxyUrl = process.env.PROXY_URL || null;

const AUDIO_DUMP_DIR = path.join(__dirname, 'audio_dumps');
if (!fs.existsSync(AUDIO_DUMP_DIR)) {
  fs.mkdirSync(AUDIO_DUMP_DIR, { recursive: true });
  console.log(`Created audio dump directory: ${AUDIO_DUMP_DIR}`);
}

let proxyAgent = null;

// Debug environment variables
console.log('Environment variables:');
console.log(`- USE_PROXY: "${process.env.USE_PROXY}"`);
console.log(`- PROXY_URL: "${process.env.PROXY_URL}"`);
console.log(`- useProxy evaluated to: ${useProxy} (${typeof useProxy})`);

if (useProxy) {
  proxyAgent = new HttpsProxyAgent(proxyUrl);
  console.log(`Proxy enabled: ${proxyUrl}`);
} else {
  console.log('Proxy disabled');
}

// Serve static files from the frontend directory
app.use(express.static(path.join(__dirname, '../frontend')));

// Groq API endpoint for speech recognition
app.post('/api/groq/speech', async (req, res) => {
  const { content, audioFormat } = req.body; // audioFormat for dumping

  // Save the audio dump for Groq API
  if (content && audioFormat) {
    try {
      const audioBuffer = Buffer.from(content, 'base64'); // Groq also receives base64
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      console.log(`[Groq] Received audioFormat: '${audioFormat}'`);
      const extension = getFormatExtension(audioFormat);
      console.log(`[Groq] Determined dump extension: '${extension}'`);
      const filename = `groq_dump_${timestamp}.${extension}`;
      const filePath = path.join(AUDIO_DUMP_DIR, filename);
      fs.writeFileSync(filePath, audioBuffer);
      console.log(`Saved Groq audio dump: ${filePath}`);
    } catch (dumpError) {
      console.error(`Error saving Groq audio dump: ${dumpError.message}`);
    }
  }

  // Original try block follows
  try {
    const apiKey = req.query.key || req.body.apiKey;
    if (!apiKey) {
      return res.status(400).json({
        error: { code: 400, message: 'Groq API key is required' }
      });
    }
    
    // Extract model, audio content, and optional parameters
    const model = req.body.model || 'whisper-large-v3';
    const content = req.body.content;
    const language = req.body.language || null;
    const prompt = req.body.prompt || null;
    
    if (!content) {
      return res.status(400).json({
        error: { code: 400, message: 'Audio content is required' }
      });
    }
    
    // Groq API URL
    const apiUrl = 'https://api.groq.com/openai/v1/audio/transcriptions';
    
    // Set up headers with API key
    const headers = {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'multipart/form-data'
    };
    
    // Create form data for the request
    const formData = new FormData();
    
    // Convert base64 to blob
    const binaryData = Buffer.from(content, 'base64');
    const blob = new Blob([binaryData]);
    
    // Add form data fields
    formData.append('file', blob, 'audio.webm');
    formData.append('model', model);
    
    // Add optional parameters if provided
    if (language) {
      formData.append('language', language);
    }
    
    if (prompt) {
      formData.append('prompt', prompt);
    }
    
    // Log request details (with truncated content)
    console.log('Request URL:', apiUrl);
    
    // Create a copy of headers for logging with truncated Authorization
    const logHeaders = { ...headers };
    if (logHeaders.Authorization) {
      logHeaders.Authorization = `${logHeaders.Authorization.substring(0, 25)}...`;
    }
    console.log('Request headers:', JSON.stringify(logHeaders, null, 2));
    console.log('Request body structure:', JSON.stringify({
      model: model,
      file: '[AUDIO_FILE_CONTENT]',
      language: language || 'auto-detect',
      prompt: prompt || null
    }, null, 2));
    
    // Forward the request to Groq's API
    const axiosConfig = {
      method: 'post',
      url: apiUrl,
      data: formData,
      headers: headers,
      validateStatus: false,
      timeout: 30000,
      proxy: false
    };
    
    // Add proxy agent if enabled
    if (useProxy && proxyAgent) {
      axiosConfig.httpsAgent = proxyAgent;
      console.log(`Using proxy for Groq API request: ${proxyUrl}`);
    }
    
    const response = await axios(axiosConfig);
    
    console.log(`Response status: ${response.status}`);
    if (response.status !== 200) {
      console.log('Error response:', response.data);
    } else {
      // For successful responses, print recognition results in plain text
      if (response.data && response.data.text) {
        const transcript = response.data.text;
        // Groq doesn't provide confidence scores directly, so we'll mark it as N/A
        console.log(`Recognition result (confidence=N/A):`, transcript);
      } else {
        console.log('Recognition RAW result:', response.data);
      }
    }
    
    // Forward the response exactly as-is back to the client
    res.status(response.status).send(response.data);
    
  } catch (error) {
    console.error('Groq proxy error:', error.message);
    console.error('Error stack:', error.stack);
    
    res.status(500).json({
      error: {
        code: 500,
        message: `Groq proxy error: ${error.message}`
      }
    });
  }
});

// Simple proxy endpoint for Speech-to-Text API (both V1 and V2)
app.post('/api/speech/:version', async (req, res) => {
  const version = req.params.version || 'v1'; // Moved here to be available for dumping filename
  const { content, audioFormat } = req.body;

  // Save the audio dump for Google API
  if (content && audioFormat) {
    try {
      const audioBuffer = Buffer.from(content, 'base64');
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      console.log(`[Google ${version}] Received audioFormat: '${audioFormat}'`);
      const extension = getFormatExtension(audioFormat);
      console.log(`[Google ${version}] Determined dump extension: '${extension}'`);
      const filename = `google_dump_${version}_${timestamp}.${extension}`;
      const filePath = path.join(AUDIO_DUMP_DIR, filename);
      fs.writeFileSync(filePath, audioBuffer);
      console.log(`Saved Google (${version}) audio dump: ${filePath}`);
    } catch (dumpError) {
      console.error(`Error saving Google (${version}) audio dump: ${dumpError.message}`);
    }
  }

  // Original try block follows
  try {
    const apiKey = req.query.key;
    if (!apiKey) {
      return res.status(400).json({ 
        error: { code: 400, message: 'API key is required' } 
      });
    }

    const version = req.params.version || 'v1';
    let apiUrl;
    
    // Different URL structure for V1 vs V2
    if (version === 'v1') {
      apiUrl = `https://speech.googleapis.com/v1/speech:recognize?key=${apiKey}`;
    } else if (version === 'v2') {
      // For V2, we need to use a valid project ID and region
      // Get project ID and region from query parameter or body
      const projectId = req.query.project || req.body.projectId || 'speech-to-text-proxy';
      const region = req.query.region || req.body.region || 'us-central1';
      
      // V2 uses a different URL structure with a valid project ID and region
      apiUrl = `https://${region}-speech.googleapis.com/v2/projects/${projectId}/locations/${region}/recognizers/_:recognize?key=${apiKey}`;
    } else {
      return res.status(400).json({
        error: { code: 400, message: `Unsupported API version: ${version}` }
      });
    }
    
    console.log(`Proxying request to ${apiUrl} through ${proxyUrl}`);
    
    // Log npm environment information
    console.log('npm_lifecycle_event:', process.env.npm_lifecycle_event);
    console.log('Using global proxy agent');
    
    // Make a clean copy of the request body without any auth-related fields
    let requestData = { ...req.body };
    
    // Extract service account if provided
    const serviceAccount = requestData.serviceAccount;
    
    // Default headers
    let headers = {
      'Content-Type': 'application/json'
    };
    
    // Determine authentication method
    if (serviceAccount && version === 'v2') {
      console.log('Service account provided, using for authentication');
      
      try {
        // Step 1: Remove service account from the request body
        delete requestData.serviceAccount;
        
        // Step 2: Create auth client and get token
        const auth = new GoogleAuth({
          credentials: serviceAccount,
          scopes: ['https://www.googleapis.com/auth/cloud-platform']
        });
        
        const client = await auth.getClient();
        const token = await client.getAccessToken();
        
        // Step 3: Set Authorization header with Bearer token
        headers['Authorization'] = `Bearer ${token.token}`;
        console.log('Using Bearer token for authentication:', token.token.substring(0, 10) + '...');
        
        // Step 4: When using service account auth, remove API key from URL
        if (apiUrl.includes('?')) {
          apiUrl = apiUrl.split('?')[0];
        }
        
        console.log('Using service account auth with URL:', apiUrl);
      } catch (authError) {
        console.error('Error getting access token:', authError);
        console.log('Falling back to API key authentication');
      }
    } else {
      console.log('Using API key authentication');
    }
    
    // Create a clean request body with correct structure based on API version
    if (version === 'v1') {
      // Extract necessary fields for V1
      const languageCode = requestData.languageCode || requestData.config?.languageCode || 'en-US';
      const model = requestData.model || requestData.config?.model || 'default';
      const content = requestData.content || (requestData.audio && requestData.audio.content);
      
      // Create clean request body for V1 API
      requestData = {
        config: {
          languageCode: languageCode,
          // alternativeLanguageCodes: ["en-US"],
          model: model,
          enableAutomaticPunctuation: true
        },
        audio: {
          content: content
        }
      };
      
      // Log the V1 API request fields for debugging
      console.log('V1 API request with languageCode:', languageCode, 'and model:', model);
    } else if (version === 'v2') {
      // Extract necessary fields for V2
      const projectId = req.query.project || requestData.projectId || 'speech-to-text-proxy';
      const region = req.query.region || requestData.region || 'us-central1';
      const languageCodes = Array.isArray(requestData.config?.language_codes) 
        ? requestData.config.language_codes 
        : [requestData.languageCode || 'en-US'];
      const model = requestData.config?.model || requestData.model || 'chirp';
      const content = requestData.content;
      
      // Create clean request body for V2 API
      requestData = {
        config: {
          language_codes: languageCodes,
          model: model,
          features: {
            enable_automatic_punctuation: true
          },
          auto_decoding_config: {}
        },
        content: content
      };
      
      // Add recognizer only if needed
      if (!apiUrl.includes('recognizers/_:recognize')) {
        requestData.recognizer = `projects/${projectId}/locations/${region}/recognizers/_`;
      }
    }
    
    // Log final request details
    console.log('Request URL:', apiUrl);
    
    // Create a copy of headers for logging with truncated Authorization
    const logHeaders = { ...headers };
    if (logHeaders.Authorization) {
      logHeaders.Authorization = `${logHeaders.Authorization.substring(0, 25)}...`;
    }
    console.log('Request headers:', JSON.stringify(logHeaders, null, 2));
    
    if (version === 'v2') {
      console.log('Request body structure:', JSON.stringify({
        ...requestData,
        content: '[BASE64_AUDIO_CONTENT]'
      }, null, 2));
    }
    else {
      console.log('Request body structure:', JSON.stringify({
        ...requestData,
        audio: {
          ...requestData.audio,
          content: '[BASE64_AUDIO_CONTENT]'
        }
      }, null, 2));
    }
    
    // Forward the request to Google's API
    const axiosConfig = {
      method: 'post',
      url: apiUrl,
      data: requestData,
      headers: headers,
      validateStatus: false, // Don't throw on error status codes
      timeout: 30000, // 30 second timeout
      proxy: false // Disable axios's built-in proxy handling
    };
    
    // Add proxy agent if enabled
    if (useProxy && proxyAgent) {
      axiosConfig.httpsAgent = proxyAgent;
      console.log(`Proxying request to ${apiUrl} through ${proxyUrl}`);
    } else {
      console.log(`Sending request to ${apiUrl} without proxy`);
    }
    
    const response = await axios(axiosConfig);
    
    console.log(`Response status: ${response.status}`);
    if (response.status !== 200) {
      console.log('Error response:', response.data);
    } else {
      // For successful responses, print recognition results in plain text
      if (response.data && response.data.results) {
        // Handle v1 API response format
        const transcripts = response.data.results
          .map(result => result.alternatives && result.alternatives[0] ? result.alternatives[0].transcript : '')
          .filter(text => text)
          .join(' ');
        
        // Extract confidence if available
        let confidence = 0;
        if (response.data.results[0] && 
            response.data.results[0].alternatives && 
            response.data.results[0].alternatives[0] && 
            response.data.results[0].alternatives[0].confidence) {
          confidence = response.data.results[0].alternatives[0].confidence;
        }
        
        console.log(`Recognition result (confidence=${confidence.toFixed(2)}):`, transcripts);
      } else if (response.data && response.data.results && response.data.results.length > 0) {
        // Handle v2 API response format
        const transcripts = response.data.results
          .map(result => result.alternatives && result.alternatives[0] ? result.alternatives[0].transcript : '')
          .filter(text => text)
          .join(' ');
        
        // Extract confidence if available
        let confidence = 0;
        if (response.data.results[0] && 
            response.data.results[0].alternatives && 
            response.data.results[0].alternatives[0] && 
            response.data.results[0].alternatives[0].confidence) {
          confidence = response.data.results[0].alternatives[0].confidence;
        }
        
        console.log(`Recognition result (confidence=${confidence.toFixed(2)}):`, transcripts);
      }
      else {
        console.log('Recognition RAW result:', response.data);
      }
    }
    
    // Forward the response exactly as-is back to the client
    res.status(response.status).send(response.data);
    
  } catch (error) {
    console.error('Proxy error:', error.message);
    console.error('Error stack:', error.stack);
    
    res.status(500).json({
      error: {
        code: 500,
        message: `Proxy error: ${error.message}`
      }
    });
  }
});

// Proxy endpoint for Speech-to-Text API (audio file upload)
app.post('/api/speech/:version/upload', upload.single('audio'), async (req, res) => {
  try {
    const apiKey = req.query.key;
    if (!apiKey) {
      return res.status(400).json({ 
        error: { code: 400, message: 'API key is required' } 
      });
    }
    
    const version = req.params.version || 'v1';
    let apiUrl;
    
    // Different URL structure for V1 vs V2
    if (version === 'v1') {
      apiUrl = `https://speech.googleapis.com/v1/speech:recognize?key=${apiKey}`;
    } else if (version === 'v2') {
      // For V2, we need to use a valid project ID and region
      // Get project ID and region from query parameter or body
      const projectId = req.query.project || req.body.projectId || 'speech-to-text-proxy';
      const region = req.query.region || req.body.region || 'us-central1';
      
      // V2 uses a different URL structure with a valid project ID and region
      apiUrl = `https://${region}-speech.googleapis.com/v2/projects/${projectId}/locations/${region}/recognizers/_:recognize?key=${apiKey}`;
    } else {
      return res.status(400).json({
        error: { code: 400, message: `Unsupported API version: ${version}` }
      });
    }
    
    if (!req.file) {
      return res.status(400).json({ 
        error: { code: 400, message: 'No audio file uploaded' } 
      });
    }
    
    // Read the file and convert to base64
    const audioFile = fs.readFileSync(req.file.path);
    const audioBase64 = audioFile.toString('base64');
    
    // Default headers
    let headers = {
      'Content-Type': 'application/json'
    };
    
    // Extract service account if provided
    let serviceAccount = null;
    if (req.body.serviceAccount) {
      try {
        serviceAccount = JSON.parse(req.body.serviceAccount);
        console.log('Service account JSON parsed from request');
      } catch (e) {
        console.error('Error parsing service account JSON:', e);
      }
    }
    
    // Determine authentication method
    if (serviceAccount && version === 'v2') {
      console.log('Service account provided for file upload, using for authentication');
      
      try {
        // Create auth client and get token
        const auth = new GoogleAuth({
          credentials: serviceAccount,
          scopes: ['https://www.googleapis.com/auth/cloud-platform']
        });
        
        const client = await auth.getClient();
        const token = await client.getAccessToken();
        
        // Set Authorization header with Bearer token
        headers['Authorization'] = `Bearer ${token.token}`;
        console.log('Using Bearer token for file upload authentication:', token.token.substring(0, 10) + '...');
        
        // When using service account auth, remove API key from URL
        if (apiUrl.includes('?')) {
          apiUrl = apiUrl.split('?')[0];
        }
        
        console.log('Using service account auth for file upload with URL:', apiUrl);
      } catch (authError) {
        console.error('Error getting access token for file upload:', authError);
        console.log('Falling back to API key authentication for file upload');
      }
    } else {
      console.log('Using API key authentication for file upload');
    }
    
    // Create request body based on API version
    let requestBody;
    if (version === 'v1') {
      requestBody = {
        config: {
          languageCode: req.body.languageCode || 'en-US',
          model: req.body.model || 'default',
          enableAutomaticPunctuation: true
        },
        audio: {
          content: audioBase64
        }
      };
    } else if (version === 'v2') {
      // Parse request data if provided
      let v2Config = null;
      if (req.body.requestData) {
        try {
          const parsedData = JSON.parse(req.body.requestData);
          v2Config = parsedData.config;
        } catch (e) {
          console.error('Error parsing requestData:', e);
        }
      }
      
      // Extract necessary fields
      const projectId = req.query.project || req.body.projectId || 'speech-to-text-proxy';
      const region = req.query.region || req.body.region || 'us-central1';
      
      // Get language codes
      let languageCodes = ['en-US'];
      if (v2Config && Array.isArray(v2Config.language_codes)) {
        languageCodes = v2Config.language_codes;
      } else if (req.body['languageCodes[]'] && Array.isArray(req.body['languageCodes[]'])) {
        languageCodes = req.body['languageCodes[]'];
      } else if (req.body.languageCode) {
        languageCodes = [req.body.languageCode];
      }
      
      // Get model
      const model = v2Config?.model || req.body.model || 'chirp';
      
      // Create clean request body
      requestBody = {
        config: {
          language_codes: languageCodes,
          model: model,
          features: {
            enable_automatic_punctuation: true
          },
          auto_decoding_config: {}
        },
        content: audioBase64
      };
      
      // Add recognizer only if needed
      if (apiUrl.includes('recognizers/_:recognize')) {
        requestBody.recognizer = `projects/${projectId}/locations/${region}/recognizers/_`;
      }
    }
    
    // Log final request details
    console.log('File upload request URL:', apiUrl);
    console.log('File upload request headers:', JSON.stringify(headers, null, 2));
    console.log('File upload request body structure:', JSON.stringify({
      ...requestBody,
      content: '[BASE64_AUDIO_CONTENT]'
    }, null, 2));
    
    // Forward the request to Google's API
    const axiosConfig = {
      method: 'post',
      url: apiUrl,
      data: requestBody,
      headers: headers,
      validateStatus: false,
      timeout: 30000,
      proxy: false
    };
    
    // Add proxy agent if enabled
    if (useProxy && proxyAgent) {
      axiosConfig.httpsAgent = proxyAgent;
      console.log(`Proxying request to ${apiUrl} through ${proxyUrl}`);
    } else {
      console.log(`Sending request to ${apiUrl} without proxy`);
    }
    
    const response = await axios(axiosConfig);
    
    console.log(`Response status: ${response.status}`);
    
    // Delete the temporary file
    if (req.file && req.file.path && fs.existsSync(req.file.path)) {
      console.log(`Deleting temporary file: ${req.file.path}`);
      fs.unlinkSync(req.file.path);
    }
    
    // Forward the response back to the client
    res.status(response.status).send(response.data);
    
  } catch (error) {
    console.error('Proxy error:', error.message);
    
    // Delete the temporary file if it exists
    if (req.file && req.file.path && fs.existsSync(req.file.path)) {
      console.log(`Deleting temporary file in error handler: ${req.file.path}`);
      fs.unlinkSync(req.file.path);
    }
    
    res.status(500).json({
      error: {
        code: 500,
        message: `Proxy error: ${error.message}`
      }
    });
  }
});

// Groq API endpoint for speech recognition (file upload)
app.post('/api/groq/speech/upload', upload.single('audio'), async (req, res) => {
  try {
    const apiKey = req.query.key || req.body.apiKey;
    if (!apiKey) {
      return res.status(400).json({
        error: { code: 400, message: 'Groq API key is required' }
      });
    }
    
    if (!req.file) {
      return res.status(400).json({ 
        error: { code: 400, message: 'No audio file uploaded' } 
      });
    }
    
    // Extract model and optional parameters
    const model = req.body.model || 'whisper-large-v3';
    const language = req.body.language || null;
    const prompt = req.body.prompt || null;
    
    // Groq API URL
    const apiUrl = 'https://api.groq.com/openai/v1/audio/transcriptions';
    
    // Set up headers with API key
    const headers = {
      'Authorization': `Bearer ${apiKey}`
      // Content-Type will be set by form-data
    };
    
    // Create form data for the request
    const FormData = require('form-data');
    const form = new FormData();
    
    // Add the audio file
    form.append('file', fs.createReadStream(req.file.path), {
      filename: req.file.originalname || 'audio.webm',
      contentType: req.file.mimetype || 'audio/webm'
    });
    form.append('model', model);
    
    // Add optional parameters if provided
    if (language) {
      form.append('language', language);
    }
    
    if (prompt) {
      form.append('prompt', prompt);
    }
    
    // Log request details
    console.log('File upload request URL:', apiUrl);
    
    // Create a copy of headers for logging with truncated Authorization
    const logHeaders = { ...headers };
    if (logHeaders.Authorization) {
      logHeaders.Authorization = `${logHeaders.Authorization.substring(0, 25)}...`;
    }
    console.log('File upload request headers:', JSON.stringify(logHeaders, null, 2));
    console.log('File upload request body structure:', JSON.stringify({
      model: model,
      file: '[AUDIO_FILE_CONTENT]',
      language: language || 'auto-detect',
      prompt: prompt || null
    }, null, 2));
    
    // Forward the request to Groq's API
    const axiosConfig = {
      method: 'post',
      url: apiUrl,
      data: form,
      headers: {
        ...headers,
        ...form.getHeaders()
      },
      responseType: 'stream',
      validateStatus: false,
      timeout: 60000,
      proxy: false
    };
    
    // Add proxy agent if enabled
    if (useProxy && proxyAgent) {
      axiosConfig.httpsAgent = proxyAgent;
      console.log(`Using proxy for Groq file upload: ${proxyUrl}`);
    }
    
    const response = await axios(axiosConfig);
    
    console.log(`Response status: ${response.status}`);
    if (response.status !== 200) {
      console.log('Error response:', response.data);
    } else {
      // For successful responses, print recognition results in plain text
      if (response.data && response.data.text) {
        const transcript = response.data.text;
        // Groq doesn't provide confidence scores directly, so we'll mark it as N/A
        console.log(`Recognition result (confidence=N/A):`, transcript);
      } else {
        console.log('Recognition RAW result:', response.data);
      }
    }
    
    // Forward the response exactly as-is back to the client
    res.status(response.status).send(response.data);
    
    // Delete the temporary file if it exists
    if (req.file && req.file.path && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
      console.log(`Deleted temporary file: ${req.file.path}`);
    }
    
  } catch (error) {
    console.error('Groq proxy error:', error.message);
    console.error('Error stack:', error.stack);
    
    // Delete the temporary file if it exists
    if (req.file && req.file.path && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
      console.log(`Deleted temporary file: ${req.file.path}`);
    }
    
    res.status(500).json({
      error: {
        code: 500,
        message: `Groq proxy error: ${error.message}`
      }
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', proxy: useProxy ? proxyUrl : null });
});

// Status endpoint
app.get('/api/status', (req, res) => {
  res.json({ 
    status: 'ok', 
    proxy: useProxy ? proxyUrl : null,
    proxyEnabled: useProxy 
  });
});

// Create HTTP server
// Azure Speech-to-Text API endpoint
app.post('/api/azure/speech', async (req, res) => {
  try {
    const apiKey = req.query.key || req.body.apiKey;
    const azureRegion = req.query.region || req.body.region;
    
    if (!apiKey) {
      return res.status(400).json({ error: { code: 400, message: 'Azure API key is required' } });
    }
    if (!azureRegion) {
      return res.status(400).json({ error: { code: 400, message: 'Azure region is required' } });
    }

    const language = req.body.language || 'en-US'; // Default to en-US
    const { content, audioFormat } = req.body; // audioFormat for dumping
    console.log(`[Azure] Received language parameter from frontend: '${language}'`);
    console.log(`[Azure] Using language for API URL: '${language}'`);

    if (!content) {
      return res.status(400).json({ error: { code: 400, message: 'Audio content is required' } });
    }

    // dedicated STT endpoint
    // const apiUrl = `https://${azureRegion}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=${language}&format=detailed`;

    // endpoint for custom subdomain
    const customSubdomain = "netnc-mbk53c89-eastus2.cognitiveservices.azure.com"; // User's custom subdomain
    const apiUrl = `https://${customSubdomain}/speech/recognition/conversation/cognitiveservices/v1?language=${language}&format=detailed`;
    console.log(`[Azure] Constructed API URL: ${apiUrl}`);
    
    // Decode base64 audio content to binary buffer
    const audioBuffer = Buffer.from(content, 'base64');

    // This is the original audioBuffer from frontend
    let audioDataForAzure = audioBuffer; 
    let finalContentTypeForAzure = getAzureContentType(audioFormat); // Initial determination
    let filePath = null; // Will hold the path to the original audio dump

    // Save the original audio dump first
    if (content && audioFormat) {
      try {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-'); // Sanitize timestamp for filename
        console.log(`[Azure] Received audioFormat: '${audioFormat}'`);
        const extension = getFormatExtension(audioFormat);
        console.log(`[Azure] Determined dump extension: '${extension}'`);
        const filename = `azure_dump_${timestamp}.${extension}`;
        filePath = path.join(AUDIO_DUMP_DIR, filename); // Assign to the outer scope filePath
        fs.writeFileSync(filePath, audioBuffer);
        console.log(`Saved Azure audio dump: ${filePath}`);
      } catch (dumpError) {
        console.error(`Error saving Azure audio dump: ${dumpError.message}`);
      }
    }

    const contentTypeForAzure = getAzureContentType(audioFormat);
    // Attempt FFMPEG conversion to OGG/Opus if not already OGG
    // Determine if conversion is needed. 
    // Azure prefers 'audio/ogg; codecs=opus'. WAV is generally fine as is.
    // So, convert if it's not WAV and not already 'audio/ogg; codecs=opus'.
    const lowerAudioFormat = audioFormat ? audioFormat.toLowerCase() : '';
    const needsConversion = 
      !lowerAudioFormat.startsWith('audio/wav') && 
      lowerAudioFormat !== 'audio/ogg; codecs=opus';

    // filePath variable (path to the original dump) should be in scope from the original dump saving block
    // Ensure 'filePath' from the original dump is accessible here or re-derive it if necessary.
    // For this change, we assume 'filePath' (e.g., /path/to/audio_dumps/azure_dump_timestamp.webm) is available.

    if (audioFormat && needsConversion && filePath && fs.existsSync(filePath)) { // Added filePath check
      const tempId = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
      // Output of ffmpeg will be temporary, then potentially saved permanently
      const tempOutputFilename = `azure_ffmpeg_out_${tempId}.ogg`;
      const tempOutputPath = path.join(AUDIO_DUMP_DIR, tempOutputFilename);

      console.log(`[Azure FFMPEG] Attempting conversion for format: ${audioFormat}. Input: ${filePath}, Output: ${tempOutputPath}`);

      try {
        // No need to write a new tempInputFile, ffmpeg will use 'filePath' (original dump)
        await new Promise((resolve, reject) => {
          ffmpeg(filePath) // Use the original dump file path as input
            .audioCodec('libopus')
            .toFormat('ogg')
            .on('error', (err) => {
              console.error(`[Azure FFMPEG] Error during conversion: ${err.message}`);
              reject(err);
            })
            .on('end', () => {
              console.log(`[Azure FFMPEG] Conversion to OGG/Opus finished successfully.`);
              resolve();
            })
            .save(tempOutputPath);
        });

        audioDataForAzure = fs.readFileSync(tempOutputPath); // Read the converted OGG file
        finalContentTypeForAzure = 'audio/ogg; codecs=opus'; // Set Content-Type for converted OGG/Opus
        console.log(`[Azure FFMPEG] Successfully converted to OGG/Opus. New buffer size: ${audioDataForAzure.length}`);

        // Save the converted file permanently for debugging
        const permanentConvertedFilename = `azure_converted_${tempId}.ogg`;
        const permanentConvertedPath = path.join(AUDIO_DUMP_DIR, permanentConvertedFilename);
        fs.writeFileSync(permanentConvertedPath, audioDataForAzure);
        console.log(`[Azure FFMPEG] Saved converted audio to: ${permanentConvertedPath}`);

      } catch (conversionError) {
        console.error(`[Azure FFMPEG] Conversion failed: ${conversionError.message}. Sending original audio.`);
        // Fallback: audioDataForAzure and finalContentTypeForAzure remain as initially set
      } finally {
        // The tempOutputPath is the direct output of ffmpeg.
        // Whether conversion succeeded (and its content was copied to a permanent file) or failed,
        // this temporary output file should always be cleaned up if it exists.
        if (fs.existsSync(tempOutputPath)) {
          fs.unlinkSync(tempOutputPath);
          console.log(`[Azure FFMPEG] Cleaned up temporary output file: ${tempOutputFilename}`);
        }
      }
    } else {
      console.log(`[Azure] Skipping FFMPEG conversion for format: ${audioFormat}. Using original/determined Content-Type.`);
    }

    console.log(`[Azure] Final Content-Type for Azure request: '${finalContentTypeForAzure}'`);

    const headers = {
      'Ocp-Apim-Subscription-Key': apiKey,
      'Content-Type': finalContentTypeForAzure,
      'Accept': 'application/json;text/xml'
    };

    console.log(`Azure Speech API Request Details:`);
    console.log(`- Method: POST`);
    console.log(`- URL: ${apiUrl}`);
    console.log(`- Request Headers Sent: ${JSON.stringify(headers, null, 2)}`);
    console.log(`- Request Body: [${audioBuffer.length} bytes audio data]`);

    const axiosConfig = {
      method: 'post',
      url: apiUrl,
      data: audioDataForAzure,
      headers: headers,
      responseType: 'text', // Get raw text to inspect and parse manually
      validateStatus: false, // Handle all status codes manually
      timeout: 30000, // 30 seconds timeout
      proxy: false
    };

    if (useProxy && proxyAgent) {
      axiosConfig.httpsAgent = proxyAgent;
      console.log(`Using proxy for Azure Speech API request: ${proxyUrl}`);
    }

    const azureAxiosResponse = await axios(axiosConfig);
    const rawResponseText = azureAxiosResponse.data; // Data is now raw text

    console.log('Azure Speech API Raw Response Text:', rawResponseText);
    console.log('Azure Speech API Response Status:', azureAxiosResponse.status);

    let responseData;
    try {
      responseData = JSON.parse(rawResponseText);
      console.log('Azure Speech API Parsed Response Data:', responseData);
    } catch (parseError) {
      console.error('Azure Speech API: Error parsing JSON response:', parseError);
      // If parsing fails, the response wasn't valid JSON. This could be an HTML error page or plain text.
      // Return the raw text as it might contain the actual error message.
      const errorStatus = azureAxiosResponse.status === 200 ? 500 : azureAxiosResponse.status;
      return res.status(errorStatus).json({
        error: {
          code: azureAxiosResponse.status, // Report original status
          message: 'Azure API response was not valid JSON.',
          details: rawResponseText // Send the raw non-JSON text
        }
      });
    }

    // At this point, responseData is the parsed JSON object from Azure.
    if (azureAxiosResponse.status === 200) {
      if (responseData && responseData.RecognitionStatus === 'Success') {
        console.log(`Recognition result: ${responseData.DisplayText}`);
        res.status(200).json(responseData);
      } else {
        // HTTP 200, but RecognitionStatus is not 'Success' or responseData is malformed/unexpected.
        const errorMessage = responseData?.DisplayText || responseData?.RecognitionStatus || 'Azure API returned a 200 OK but with non-success status or unrecognized response format';
        console.error(`Azure Speech API Error (Status ${azureAxiosResponse.status}, Recognition: ${responseData?.RecognitionStatus}): ${errorMessage}`);
        // Treat as an internal server error from our app's perspective if Azure said 200 but content is problematic.
        res.status(500).json({ 
          error: { 
            code: azureAxiosResponse.status, // Keep original Azure status for info
            message: `Azure Speech API Error: ${errorMessage}`,
            details: responseData // Send back the problematic parsed data
          } 
        });
      }
    } else {
      // Non-200 response from Azure. responseData (parsed from rawResponseText) should contain Azure's error details.
      const errorMessage = responseData?.error?.message || responseData?.Message || 'Unknown Azure API error (non-200 status)';
      console.error(`Azure Speech API HTTP Error (Status ${azureAxiosResponse.status}): ${errorMessage}`);
      res.status(azureAxiosResponse.status).json({ 
        error: { 
          code: azureAxiosResponse.status, 
          message: `Azure Speech API HTTP Error: ${errorMessage}`,
          details: responseData // Send Azure's structured error response
        } 
      });
    }

  } catch (error) {
    // This catches errors from the axios call itself (e.g., network error, timeout) or other unexpected errors.
    console.error('Azure proxy error or unhandled exception in /api/azure/speech:', error.message);
    if (error.isAxiosError && error.response) {
      // Log details if it's an Axios error with a response from server/proxy
      console.error('Axios error response data:', error.response.data);
      console.error('Axios error response status:', error.response.status);
      res.status(error.response.status || 500).json({
        error: {
          code: error.response.status || 500,
          message: `Azure proxy error: ${error.message}`,
          details: error.response.data
        }
      });
    } else if (error.isAxiosError && error.request) {
        // Axios error, but no response received (e.g. network error)
        console.error('Axios error request data:', error.request);
        res.status(500).json({
            error: {
                code: 500,
                message: `Network error or no response from Azure/proxy: ${error.message}`
            }
        });
    } else {
      // Non-Axios error or Axios error without response/request details
      res.status(500).json({
        error: {
          code: 500,
          message: `Azure proxy error or internal server error: ${error.message}`,
          details: error.cause || null
        }
      });
    }
  }
});

function getFormatExtension(mimeType) {
  console.log(`[getFormatExtension] Received mimeType: ${mimeType}`);

  if (!mimeType) return 'dat'; // Default extension
  const lowerMimeType = mimeType.toLowerCase();

  // Prioritize container format extension first
  if (lowerMimeType.startsWith('audio/webm')) {
    return 'webm'; // WebM container, save as .webm
  }
  if (lowerMimeType.startsWith('audio/ogg')) {
    return 'ogg';   // OGG container, save as .ogg
  }
  // Specific known types after container checks
  if (lowerMimeType.startsWith('audio/wav') || lowerMimeType.startsWith('audio/x-wav')) {
    return 'wav';
  }
  if (lowerMimeType.includes('mpeg')) {
    return 'mp3';
  }
  if (lowerMimeType.includes('mp4') || lowerMimeType.includes('aac')) return 'm4a'; // .m4a is common for AAC in MP4 container
  if (lowerMimeType.includes('flac')) return 'flac';
  if (lowerMimeType.includes('text/plain')) return 'txt'; // For text-based things if ever needed
  
  // Fallback for unknown types, try to get it from after '/'
  const parts = lowerMimeType.split('/');
  if (parts.length > 1) {
    return parts[1].split(';')[0]; // e.g., 'audio/custom-format' -> 'custom-format'
  }
  return 'dat';
}

function getAzureContentType(frontendFormat) {
  console.log(`[getAzureContentType] Received frontendFormat: ${frontendFormat}`);
  
  if (!frontendFormat) {
    console.warn('No audioFormat provided to getAzureContentType, defaulting to application/octet-stream');
    return 'application/octet-stream';
  }

  const lowerFormat = frontendFormat.toLowerCase();

  if (lowerFormat.startsWith('audio/webm') || lowerFormat.startsWith('audio/ogg')) {
    // Azure supports OGG container for Opus. If WebM/Opus, this is the target.
    return 'audio/ogg; codecs=opus';
  }
  if (lowerFormat.startsWith('audio/wav')) {
    // For WAV, Azure can often infer samplerate etc. if not specified.
    // A more specific example: 'audio/wav; codecs=audio/pcm; samplerate=16000'
    return 'audio/wav'; 
  }
  if (lowerFormat.startsWith('audio/mpeg')) {
    return 'audio/mpeg'; // For MP3
  }
  if (lowerFormat.startsWith('audio/mp4') || lowerFormat.startsWith('audio/aac')) {
    // M4A/AAC files are typically in an MP4 container.
    return 'audio/mp4'; 
  }
  if (lowerFormat.startsWith('audio/flac')) {
    return 'audio/flac';
  }
  // Add other mappings as needed for formats like AMR, ALAW, MULAW.
  // e.g., if (lowerFormat.startsWith('audio/amr')) return 'audio/amr';
  
  console.warn(`Unknown audio format for Azure: '${frontendFormat}', falling back to application/octet-stream`);
  return 'application/octet-stream'; // Fallback, Azure might not support this directly unless it's a known raw stream type.
}

// The line below is the original TargetContent, preserved after the new code block.
const server = http.createServer(app);

// Create WebSocket server
const wss = new WebSocket.Server({ server });

// Handle WebSocket connections
wss.on('connection', (ws) => {
  console.log('WebSocket client connected');
  
  // Handle messages from clients
  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);
      const sessionId = data.sessionId || 'no-session';
      console.log(`[Session: ${sessionId}] Received WebSocket message type:`, data.type);
      
      if (data.type === 'start_stream') {
        if (data.api === 'google') {
          handleGoogleStreamingRequest(ws, data, sessionId);
        } else if (data.api === 'groq') {
          handleGroqStreamingRequest(ws, data, sessionId);
        } else {
          ws.send(JSON.stringify({ type: 'error', message: 'Invalid API type', sessionId }));
        }
      }
    } catch (error) {
      console.error('WebSocket message error:', error);
      ws.send(JSON.stringify({ type: 'error', message: error.message }));
    }
  });
  
  // Handle client disconnection
  ws.on('close', () => {
    console.log('WebSocket client disconnected');
  });
  
  // Send initial connection confirmation
  ws.send(JSON.stringify({ type: 'connected' }));
});

// Google Speech-to-Text streaming handler
async function handleGoogleStreamingRequest(ws, data, sessionId) {
  try {
    // Extract parameters from the request
    const { api, apiKey, content, languageCode, model, serviceAccount } = data;
    const apiVersion = api || 'v1'; // Default to v1 if not specified
    
    // Check if we have authentication information
    if (!apiKey && !serviceAccount) {
      ws.send(JSON.stringify({ type: 'error', message: 'API key or service account is required', sessionId }));
      return;
    }
    
    if (!content) {
      ws.send(JSON.stringify({ type: 'error', message: 'Audio content is required', sessionId }));
      return;
    }
    
    // Send acknowledgment to client
    ws.send(JSON.stringify({ 
      type: 'start', 
      message: `Starting Google ${apiVersion} streaming transcription`,
      sessionId
    }));
    
    // Create a client based on the authentication method
    let client;
    
    if (serviceAccount) {
      // Use service account authentication if provided
      try {
        // Create a temporary file for the service account JSON
        const serviceAccountPath = path.join(uploadsDir, `service_account_${Date.now()}.json`);
        fs.writeFileSync(serviceAccountPath, JSON.stringify(serviceAccount));
        
        // Create client with service account
        client = new speech.SpeechClient({
          keyFilename: serviceAccountPath
        });
        
        // Clean up the temporary file
        setTimeout(() => {
          fs.unlink(serviceAccountPath, (err) => {
            if (err) console.error('Error deleting service account file:', err);
          });
        }, 1000);
        
        console.log(`[Session: ${sessionId}] Using service account authentication for Google ${apiVersion} streaming`);
      } catch (error) {
        console.error('Error creating client with service account:', error);
        ws.send(JSON.stringify({ type: 'error', message: `Service account error: ${error.message}`, sessionId }));
        return;
      }
    } else {
      // Use API key authentication
      try {
        // API key authentication has limitations with streaming
        if (apiVersion === 'v2') {
          ws.send(JSON.stringify({ 
            type: 'warning', 
            message: 'Google Speech V2 streaming with API key has limitations. For best results, use a service account.',
            sessionId
          }));
        }
        
        client = new speech.SpeechClient({ 
          credentials: { client_email: null, private_key: null },
          projectId: 'placeholder-project',
          authClient: new GoogleAuth().fromAPIKey(apiKey)
        });
        console.log(`[Session: ${sessionId}] Using API key authentication for Google ${apiVersion} streaming`);
      } catch (error) {
        console.error('Error creating client with API key:', error);
        ws.send(JSON.stringify({ type: 'error', message: `API key error: ${error.message}`, sessionId }));
        return;
      }
    }
    
    // Create streaming recognize request with appropriate configuration based on API version
    let requestConfig = {
      encoding: 'WEBM_OPUS',
      sampleRateHertz: 48000,
      languageCode: languageCode || 'en-US',
      enableAutomaticPunctuation: true
    };
    
    // Handle model differently based on API version
    if (apiVersion === 'v1') {
      // For V1, we can use the model directly
      requestConfig.model = model || 'default';
      
      // Add V1-specific options
      Object.assign(requestConfig, {
        enableWordTimeOffsets: false,
        useEnhanced: true,
        maxAlternatives: 1,
        profanityFilter: false,
        speechContexts: [{
          phrases: []
        }],
        enableWordConfidence: true,
        enableSpokenPunctuation: true,
        enableSpokenEmojis: true
      });
    }
    // For V2, we need to be more careful with the model names
    else if (apiVersion === 'v2') {
      // V2 has different model naming conventions
      // Only set the model if it's a valid V2 model name
      if (model && (model === 'chirp' || model === 'chirp_2' || model === 'chirp_3' || model === 'latest_long' || model === 'latest_short' || model === 'telephony')) {
        requestConfig.model = model;
      }
      // Otherwise, don't set a model at all to use the default
      console.log(`[Session: ${sessionId}] Using Google V2 API with model: ${model || 'default'}`);
    }
    
    // Add a response counter to track the sequence of responses
    let responseCounter = 0;
    
    // Track the last transcript to prevent duplicates
    let lastTranscript = '';
    let lastFinalTranscript = '';
    
    const request = {
      config: requestConfig,
      interimResults: true
    };
    
    // Create a recognize stream
    const recognizeStream = client
      .streamingRecognize(request)
      .on('error', (error) => {
        console.error(`[Session: ${sessionId}] Google Speech streaming error:`, error);
        ws.send(JSON.stringify({ type: 'error', message: `Streaming error: ${error.message}`, sessionId }));
      })
      .on('data', (data) => {
        // Increment the response counter
        responseCounter++;
        
        // Process the response if it contains results
        if (data.results && data.results.length > 0) {
          const result = data.results[0];
          const isFinal = result.isFinal;
          const transcript = result.alternatives[0].transcript;
          const confidence = result.alternatives[0].confidence || 0;
          
          // Check for duplicate or empty transcripts
          const isDuplicate = transcript === lastTranscript;
          const isFinalDuplicate = isFinal && transcript === lastFinalTranscript;
          
          // Log detailed information about the response
          console.log(`[${apiVersion}][Session: ${sessionId}] Stream Response #${responseCounter}:`, {
            resultCount: data.results.length,
            isFinal: isFinal,
            transcript: transcript,
            confidence: confidence,
            stability: result.stability || 'N/A',
            resultEndTime: result.resultEndTime || 'N/A',
            languageCode: result.languageCode || 'N/A',
            alternativesCount: result.alternatives.length,
            isDuplicate: isDuplicate,
            isFinalDuplicate: isFinalDuplicate
          });
          
          // Only send non-duplicate responses to the client
          // For interim results, we allow the same transcript to be sent if it's not consecutive
          // For final results, we're more strict to avoid duplicates
          if (!isDuplicate || (isFinal && !isFinalDuplicate)) {
            // Send transcription results to client with sequence number and additional data
            ws.send(JSON.stringify({
              type: 'transcription',
              sequence: responseCounter,
              isFinal,
              transcript,
              confidence: confidence,
              stability: result.stability || null,
              resultEndTime: result.resultEndTime || null,
              alternativesCount: result.alternatives.length,
              isDuplicate: isDuplicate,
              sessionId
            }));
            
            // Update tracking variables
            lastTranscript = transcript;
            if (isFinal) {
              lastFinalTranscript = transcript;
              console.log(`[Session: ${sessionId}] Final transcript: ${transcript}`);
              console.log(`[Session: ${sessionId}] Confidence: ${confidence}`);
            }
          } else {
            console.log(`[Session: ${sessionId}] Skipping duplicate transcript: "${transcript}"`);
          }
        } else {
          console.log(`[${apiVersion}][Session: ${sessionId}] Stream Response #${responseCounter}: No results in response`);
        }
      })
      .on('end', () => {
        console.log(`[Session: ${sessionId}] Google Speech streaming ended`);
        ws.send(JSON.stringify({ type: 'end', message: 'Streaming ended', sessionId }));
      });
    
    // Convert base64 audio to buffer and send to recognize stream
    const audioBuffer = Buffer.from(content, 'base64');
    const audioStream = new Readable();
    audioStream.push(audioBuffer);
    audioStream.push(null);
    audioStream.pipe(recognizeStream);
    
    console.log(`[Session: ${sessionId}] Started Google Speech streaming transcription`);
  } catch (error) {
    console.error(`[Session: ${sessionId}] Google streaming handler error:`, error);
    ws.send(JSON.stringify({ type: 'error', message: error.message, sessionId }));
  }
}

// Groq Whisper streaming handler
async function handleGroqStreamingRequest(ws, data, sessionId) {
  try {
    // Extract parameters from the request
    const { apiKey, content, model, language, prompt, fileType, fileName } = data;
    
    if (!apiKey) {
      ws.send(JSON.stringify({ type: 'error', message: 'API key is required', sessionId }));
      return;
    }
    
    if (!content) {
      ws.send(JSON.stringify({ type: 'error', message: 'Audio content is required', sessionId }));
      return;
    }
    
    // Send acknowledgment to client
    ws.send(JSON.stringify({ type: 'start', message: 'Starting Groq streaming transcription', sessionId }));
    
    // Groq API URL for transcriptions (not streaming specific)
    const apiUrl = 'https://api.groq.com/openai/v1/audio/transcriptions';
    
    // Create form data for the request
    const FormData = require('form-data');
    const form = new FormData();
    
    // Get the binary data from base64
    const binaryData = Buffer.from(content, 'base64');
    
    // For Groq API, we'll use WAV format which is most widely supported
    // First, determine what format we're dealing with
    let detectedFormat = '';
    
    // Check for WAV header (RIFF)
    if (binaryData.length >= 12 && 
        binaryData.toString('ascii', 0, 4) === 'RIFF' && 
        binaryData.toString('ascii', 8, 12) === 'WAVE') {
      detectedFormat = 'wav';
    }
    // Check for MP3 header (ID3 or MPEG frame sync)
    else if (binaryData.length >= 3 && 
             (binaryData.toString('ascii', 0, 3) === 'ID3' || 
              (binaryData[0] === 0xFF && (binaryData[1] & 0xE0) === 0xE0))) {
      detectedFormat = 'mp3';
    }
    // Check for Ogg header (OggS)
    else if (binaryData.length >= 4 && binaryData.toString('ascii', 0, 4) === 'OggS') {
      detectedFormat = 'ogg';
    }
    // Check for FLAC header (fLaC)
    else if (binaryData.length >= 4 && binaryData.toString('ascii', 0, 4) === 'fLaC') {
      detectedFormat = 'flac';
    }
    // Default to mp3 for WebM or other formats
    else {
      detectedFormat = 'mp3';
    }
    
    console.log(`[Session: ${sessionId}] Detected audio format: ${detectedFormat}`);
    
    // Create a temporary file with the appropriate extension
    const tempFilePath = path.join(uploadsDir, `temp_${Date.now()}.${detectedFormat}`);
    
    // Write to temporary file
    fs.writeFileSync(tempFilePath, binaryData);
    
    // For Groq API, we'll use a simple approach - just send the file directly
    // This is more reliable than trying to convert formats on the fly
    
    // Add the audio file to the form with appropriate content type
    form.append('file', fs.createReadStream(tempFilePath), {
      filename: `audio.${detectedFormat}`,
      contentType: `audio/${detectedFormat}`
    });
    
    // Add model and other parameters
    form.append('model', model || 'whisper-large-v3');
    
    // Add optional parameters if provided
    if (language) {
      form.append('language', language);
    }
    
    if (prompt) {
      form.append('prompt', prompt);
    }
    
    // Set up headers with API key
    const headers = {
      'Authorization': `Bearer ${apiKey}`
    };
    
    // Configure axios request
    const axiosConfig = {
      method: 'post',
      url: apiUrl,
      data: form,
      headers: {
        ...headers,
        ...form.getHeaders()
      },
      responseType: 'stream',
      validateStatus: false,
      timeout: 60000,
      proxy: false
    };
    
    // Add proxy agent if enabled
    if (useProxy && proxyAgent) {
      axiosConfig.httpsAgent = proxyAgent;
      console.log(`[Session: ${sessionId}] Using proxy for Groq streaming: ${proxyUrl}`);
    }
    
    console.log(`[Session: ${sessionId}] Starting Groq streaming request`);
    
    // Make the request to Groq API
    const response = await axios(axiosConfig);
    
    if (response.status !== 200) {
      // Handle error response
      let errorMessage = 'Groq API error';
      const chunks = [];
      
      response.data.on('data', chunk => chunks.push(chunk));
      response.data.on('end', () => {
        try {
          const errorData = JSON.parse(Buffer.concat(chunks).toString());
          errorMessage = errorData.error?.message || `Error: ${response.status}`;
        } catch (e) {
          errorMessage = `Error: ${response.status}`;
        }
        
        ws.send(JSON.stringify({ type: 'error', message: errorMessage, sessionId }));
        
        // Clean up temp file
        fs.unlink(tempFilePath, (err) => {
          if (err) console.error('Error deleting temp file:', err);
        });
      });
      
      return;
    }
    
    // Process streaming response
    let buffer = '';
    
    response.data.on('data', (chunk) => {
      const chunkStr = chunk.toString();
      buffer += chunkStr;
      
      // Process complete JSON objects
      let startIdx = 0;
      let endIdx = buffer.indexOf('\n', startIdx);
      
      while (endIdx !== -1) {
        const line = buffer.substring(startIdx, endIdx).trim();
        startIdx = endIdx + 1;
        
        if (line.startsWith('data: ')) {
          const jsonStr = line.substring(6).trim();
          
          if (jsonStr === '[DONE]') {
            // End of stream
            ws.send(JSON.stringify({ type: 'end', message: 'Streaming ended', sessionId }));
          } else {
            try {
              const data = JSON.parse(jsonStr);
              
              // Send partial transcription to client
              ws.send(JSON.stringify({
                type: 'transcription',
                isFinal: false,
                transcript: data.text || '',
                confidence: data.confidence || 0,
                sessionId
              }));
              
            } catch (e) {
              console.error('Error parsing Groq streaming response:', e);
            }
          }
        }
        
        endIdx = buffer.indexOf('\n', startIdx);
      }
      
      // Keep any remaining partial data
      buffer = buffer.substring(startIdx);
    });
    
    response.data.on('end', () => {
      console.log(`[Session: ${sessionId}] Groq streaming ended`);
      ws.send(JSON.stringify({ type: 'end', message: 'Streaming ended', sessionId }));
      
      // Clean up temp file
      fs.unlink(tempFilePath, (err) => {
        if (err) console.error('Error deleting temp file:', err);
      });
    });
    
    response.data.on('error', (error) => {
      console.error('Groq streaming error:', error);
      ws.send(JSON.stringify({ type: 'error', message: `Streaming error: ${error.message}`, sessionId }));
      
      // Clean up temp file
      fs.unlink(tempFilePath, (err) => {
        if (err) console.error('Error deleting temp file:', err);
      });
    });
    
    console.log(`[Session: ${sessionId}] Started Groq streaming transcription`);
  } catch (error) {
    console.error(`[Session: ${sessionId}] Groq streaming handler error:`, error);
    ws.send(JSON.stringify({ type: 'error', message: error.message, sessionId }));
  }
}

// Start the server
const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`WebSocket server available at ws://localhost:${PORT}`);
  if (useProxy) {
    console.log(`Proxy enabled: ${proxyUrl}`);
  } else {
    console.log('Proxy disabled');
  }
  console.log(`Current working directory: ${process.cwd()}`);
  console.log(`Node version: ${process.version}`);
  console.log(`Process ID: ${process.pid}`);
});
