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
    console.log('Request body structure:', JSON.stringify({
      ...req.body,
      audio: req.body.audio ? { content: '[BASE64_AUDIO_CONTENT]' } : undefined,
      content: req.body.content ? '[BASE64_AUDIO_CONTENT]' : undefined
    }, null, 2));
    
    // Log npm environment information
    console.log('npm_lifecycle_event:', process.env.npm_lifecycle_event);
    console.log('Using global proxy agent');
    
    // Check if service account is provided in the request body
    let requestData = { ...req.body };
    const serviceAccount = requestData.serviceAccount;
    let headers = {
      'Content-Type': 'application/json'
    };
    
    // If service account is provided, use it for authentication
    if (serviceAccount && version === 'v2') {
      try {
        // Remove serviceAccount from the request body
        delete requestData.serviceAccount;
        console.log('Service account provided, using for authentication');
        
        // Create auth client from service account
        const auth = new GoogleAuth({
          credentials: serviceAccount,
          scopes: ['https://www.googleapis.com/auth/cloud-platform']
        });
        
        // Get access token
        const client = await auth.getClient();
        const token = await client.getAccessToken();
        
        // Use token in request headers
        headers['Authorization'] = `Bearer ${token.token}`;
        
        // Remove API key from URL if using service account auth
        apiUrl = apiUrl.replace(`?key=${apiKey}`, '');
        console.log(`Using service account auth, updated URL: ${apiUrl}`);
      } catch (authError) {
        console.error('Error getting access token:', authError);
        console.log('Falling back to API key authentication');
      }
    } else {
      console.log('Using API key authentication');
    }
    
    // Forward the request to Google's API
    const response = await axios({
      method: 'post',
      url: apiUrl,
      data: requestData,
      headers: headers,
      httpsAgent: proxyAgent, // Using the global proxy agent
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
    
    // Create request body based on API version
    let requestBody;
    if (version === 'v1') {
      requestBody = {
        config: {
          languageCode: req.body.languageCode || 'en-US',
          model: req.body.model || 'default',
          enableAutomaticPunctuation: true
          // Do not specify encoding or sampleRateHertz
          // Let Google auto-detect the audio format
        },
        audio: {
          content: audioBase64
        }
      };
    } else if (version === 'v2') {
      // For V2, update the recognizer field to use the same project ID and region
      const projectId = req.query.project || req.body.projectId || 'speech-to-text-proxy';
      const region = req.query.region || req.body.region || 'us-central1';
      
      // Check if the client sent a pre-formatted request structure
      if (req.body.requestData) {
        try {
          // Parse the request data JSON string
          const parsedRequestData = JSON.parse(req.body.requestData);
          requestBody = parsedRequestData;
          
          // Add the audio content to the request
          requestBody.content = audioBase64;
          
          console.log('Using pre-formatted request data from client');
        } catch (parseError) {
          console.error('Error parsing requestData:', parseError);
          // Fall back to constructing the request manually
        }
      }
      
      // If we don't have a valid request body yet, construct it
      if (!requestBody) {
        // Check if multiple languages were provided
        let languageCodes = [];
        
        // Handle form data with array notation (from file upload)
        if (req.body['languageCodes[]'] && Array.isArray(req.body['languageCodes[]'])) {
          languageCodes = req.body['languageCodes[]'];
        }
        // Handle direct array (from JSON request)
        else if (req.body.languageCodes && Array.isArray(req.body.languageCodes)) {
          languageCodes = req.body.languageCodes;
        }
        // Handle config.language_codes from the properly formatted request
        else if (req.body.config && req.body.config.language_codes && Array.isArray(req.body.config.language_codes)) {
          languageCodes = req.body.config.language_codes;
        }
        // Handle single language code
        else if (req.body.languageCode) {
          languageCodes = [req.body.languageCode];
        }
        // Default
        else {
          languageCodes = ['en-US'];
        }
        
        // If the request is already in the correct format, use it directly
        if (req.body.recognizer && req.body.config && req.body.content) {
          requestBody = req.body;
          // Still ensure the language_codes are set correctly
          requestBody.config.language_codes = languageCodes;
        } else {
          // Otherwise construct the proper format
          requestBody = {
            recognizer: `projects/${projectId}/locations/${region}/recognizers/_`,
            config: {
              language_codes: languageCodes,
              model: req.body.model || 'chirp',
              auto_decoding_config: {}
            },
            content: audioBase64
          };
        }
      }
    }
    
    console.log(`Proxying file upload to ${apiUrl} through ${proxyUrl}`);
    console.log('Request body structure:', JSON.stringify({
      ...requestBody,
      audio: requestBody.audio ? { content: '[BASE64_AUDIO_CONTENT]' } : undefined,
      content: requestBody.content ? '[BASE64_AUDIO_CONTENT]' : undefined
    }, null, 2));
    
    // Forward the request to Google's API
    const response = await axios({
      method: 'post',
      url: apiUrl,
      data: requestBody,
      headers: {
        'Content-Type': 'application/json'
      },
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
