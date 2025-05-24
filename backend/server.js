const express = require('express');
const cors = require('cors');
const axios = require('axios');
const multer = require('multer');
const { HttpsProxyAgent } = require('https-proxy-agent');
const fs = require('fs');
const path = require('path');
const { GoogleAuth } = require('google-auth-library');
const dotenv = require('dotenv');

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
const proxyUrl = process.env.PROXY_URL || 'http://127.0.0.1:8888';
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
  try {
    const apiKey = req.query.key || req.body.apiKey;
    if (!apiKey) {
      return res.status(400).json({
        error: { code: 400, message: 'Groq API key is required' }
      });
    }
    
    // Extract model and audio content
    const model = req.body.model || 'whisper-large-v3';
    const content = req.body.content;
    
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
      file: '[AUDIO_FILE_CONTENT]'
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
    
    // Extract model
    const model = req.body.model || 'whisper-large-v3';
    
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
      file: '[AUDIO_FILE_CONTENT]'
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
      validateStatus: false,
      timeout: 30000,
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

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  if (useProxy) {
    console.log(`Proxy enabled: ${proxyUrl}`);
  } else {
    console.log('Proxy disabled');
  }
  console.log(`Current working directory: ${process.cwd()}`);
  console.log(`Node version: ${process.version}`);
  console.log(`Process ID: ${process.pid}`);
});
