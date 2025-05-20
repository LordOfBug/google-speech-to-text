const express = require('express');
const cors = require('cors');
const axios = require('axios');
const multer = require('multer');
const { HttpsProxyAgent } = require('https-proxy-agent');
const fs = require('fs');
const path = require('path');
const { GoogleAuth } = require('google-auth-library');

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
const proxyUrl = 'http://127.0.0.1:8888';
const proxyAgent = new HttpsProxyAgent(proxyUrl);

// Serve static files from the frontend directory
app.use(express.static(path.join(__dirname, '../frontend')));

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
    
    // Step 5: Create a clean request body with correct structure for V2
    if (version === 'v2') {
      // Extract necessary fields
      const projectId = req.query.project || requestData.projectId || 'speech-to-text-proxy';
      const region = req.query.region || requestData.region || 'us-central1';
      const languageCodes = Array.isArray(requestData.config?.language_codes) 
        ? requestData.config.language_codes 
        : [requestData.languageCode || 'en-US'];
      const model = requestData.config?.model || requestData.model || 'chirp';
      const content = requestData.content;
      
      // Create clean request body
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
    console.log('Request headers:', JSON.stringify(headers, null, 2));
    console.log('Request body structure:', JSON.stringify({
      ...requestData,
      content: '[BASE64_AUDIO_CONTENT]'
    }, null, 2));
    
    // Forward the request to Google's API
    const response = await axios({
      method: 'post',
      url: apiUrl,
      data: requestData,
      headers: headers,
      httpsAgent: proxyAgent,
      validateStatus: false, // Don't throw on error status codes
      timeout: 30000, // 30 second timeout
      proxy: false // Disable axios's built-in proxy handling
    });
    
    console.log(`Response status: ${response.status}`);
    if (response.status !== 200) {
      console.log('Error response:', response.data);
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
    const response = await axios({
      method: 'post',
      url: apiUrl,
      data: requestBody,
      headers: headers,
      httpsAgent: proxyAgent,
      validateStatus: false, // Don't throw on error status codes
      timeout: 30000, // 30 second timeout
      proxy: false // Disable axios's built-in proxy handling
    });
    
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

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', proxy: proxyUrl });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Proxy server running on port ${PORT}`);
  console.log(`Using proxy: ${proxyUrl}`);
  console.log(`Current working directory: ${process.cwd()}`);
  console.log(`Node version: ${process.version}`);
  console.log(`Process ID: ${process.pid}`);
});
