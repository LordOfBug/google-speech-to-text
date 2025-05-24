// DOM Elements
const recordButton = document.getElementById('record-button');
const uploadButton = document.getElementById('upload-button');
const statusElement = document.getElementById('status');
const transcriptElement = document.getElementById('transcript');
const confidenceElement = document.getElementById('confidence');
const debugModeCheckbox = document.getElementById('debug-mode');
const debugCard = document.getElementById('debug-card');
const debugOutput = document.getElementById('debug-output');
const audioLevelFill = document.getElementById('audio-level-fill');

// API Version Tabs
const v1Tab = document.getElementById('v1-tab');
const v2Tab = document.getElementById('v2-tab');
const groqTab = document.getElementById('groq-tab');

// API Inputs
const v1ApiKey = document.getElementById('v1-api-key');
const v1Language = document.getElementById('v1-language');
const v1Model = document.getElementById('v1-model');
const v1FileUpload = document.getElementById('v1-file-upload');

const v2ApiKey = document.getElementById('v2-api-key');
const v2ProjectId = document.getElementById('v2-project-id');
const v2Region = document.getElementById('v2-region');
const v2ServiceAccount = document.getElementById('v2-service-account');
const v2LanguageCheckboxes = document.querySelectorAll('.v2-language-checkbox');
const v2Model = document.getElementById('v2-model');
const v2FileUpload = document.getElementById('v2-file-upload');

// Groq API Inputs
const groqApiKey = document.getElementById('groq-api-key');
const groqModel = document.getElementById('groq-model');
const groqLanguage = document.getElementById('groq-language');
const groqPrompt = document.getElementById('groq-prompt');
const groqFileUpload = document.getElementById('groq-file-upload');

// Service account data
let serviceAccountData = null;

// State
let isRecording = false;
let mediaRecorder = null;
let audioChunks = [];
let animationFrameId = null;
let audioContext = null;
let analyser = null;
let microphoneStream = null;
let currentApiVersion = 'v1';

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  // Load saved API keys, project ID and region from localStorage
  const savedV1Key = localStorage.getItem('v1ApiKey');
  const savedV2Key = localStorage.getItem('v2ApiKey');
  const savedV2ProjectId = localStorage.getItem('v2ProjectId');
  const savedV2Region = localStorage.getItem('v2Region');
  const savedGroqKey = localStorage.getItem('groqApiKey');
  
  if (savedV1Key) v1ApiKey.value = savedV1Key;
  if (savedV2Key) v2ApiKey.value = savedV2Key;
  if (savedV2ProjectId) v2ProjectId.value = savedV2ProjectId;
  if (savedV2Region) v2Region.value = savedV2Region;
  if (savedGroqKey) groqApiKey.value = savedGroqKey;
  
  // Load saved language selections for V2
  const savedV2Languages = localStorage.getItem('v2SelectedLanguages');
  if (savedV2Languages) {
    try {
      const languages = JSON.parse(savedV2Languages);
      // Uncheck all first
      v2LanguageCheckboxes.forEach(checkbox => checkbox.checked = false);
      // Then check the saved ones
      languages.forEach(lang => {
        const checkbox = document.getElementById(`lang-${lang}`);
        if (checkbox) checkbox.checked = true;
      });
    } catch (e) {
      console.error('Error loading saved languages:', e);
    }
  }
  
  // Set up event listeners
  recordButton.addEventListener('click', toggleRecording);
  uploadButton.addEventListener('click', handleFileUpload);
  debugModeCheckbox.addEventListener('checked', toggleDebugMode);
  
  // API version tab switching
  v1Tab.addEventListener('click', () => setApiVersion('v1'));
  v2Tab.addEventListener('click', () => setApiVersion('v2'));
  groqTab.addEventListener('click', () => setApiVersion('groq'));
  
  // Service account file upload
  v2ServiceAccount.addEventListener('change', handleServiceAccountUpload);
  
  // Initialize debug mode from localStorage
  const debugMode = localStorage.getItem('debugMode') === 'true';
  debugModeCheckbox.checked = debugMode;
  toggleDebugMode();
  
  // Check if browser supports getUserMedia
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    statusElement.textContent = 'Your browser does not support audio recording';
    statusElement.className = 'alert alert-danger';
    recordButton.disabled = true;
  }
});

// Handle service account file upload
function handleServiceAccountUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const jsonData = JSON.parse(e.target.result);
      serviceAccountData = jsonData;
      
      // Extract project ID from service account if available
      if (jsonData.project_id && !v2ProjectId.value) {
        v2ProjectId.value = jsonData.project_id;
        localStorage.setItem('v2ProjectId', jsonData.project_id);
      }
      
      statusElement.textContent = 'Service account loaded successfully';
      statusElement.className = 'alert alert-success';
      logDebug('Service account loaded', { 
        project_id: jsonData.project_id,
        client_email: jsonData.client_email
      });
    } catch (error) {
      console.error('Error parsing service account JSON:', error);
      statusElement.textContent = 'Error loading service account: Invalid JSON';
      statusElement.className = 'alert alert-danger';
      serviceAccountData = null;
    }
  };
  reader.readAsText(file);
}

// Set API version
function setApiVersion(version) {
  currentApiVersion = version;
  
  // Update UI
  if (version === 'v1') {
    v1Tab.classList.add('active');
    v1Tab.setAttribute('aria-selected', 'true');
    v2Tab.classList.remove('active');
    v2Tab.setAttribute('aria-selected', 'false');
    groqTab.classList.remove('active');
    groqTab.setAttribute('aria-selected', 'false');
    
    document.getElementById('v1-content').classList.add('show', 'active');
    document.getElementById('v2-content').classList.remove('show', 'active');
    document.getElementById('groq-content').classList.remove('show', 'active');
  } else if (version === 'v2') {
    v2Tab.classList.add('active');
    v2Tab.setAttribute('aria-selected', 'true');
    v1Tab.classList.remove('active');
    v1Tab.setAttribute('aria-selected', 'false');
    groqTab.classList.remove('active');
    groqTab.setAttribute('aria-selected', 'false');
    
    document.getElementById('v2-content').classList.add('show', 'active');
    document.getElementById('v1-content').classList.remove('show', 'active');
    document.getElementById('groq-content').classList.remove('show', 'active');
  } else if (version === 'groq') {
    groqTab.classList.add('active');
    groqTab.setAttribute('aria-selected', 'true');
    v1Tab.classList.remove('active');
    v1Tab.setAttribute('aria-selected', 'false');
    v2Tab.classList.remove('active');
    v2Tab.setAttribute('aria-selected', 'false');
    
    document.getElementById('groq-content').classList.add('show', 'active');
    document.getElementById('v1-content').classList.remove('show', 'active');
    document.getElementById('v2-content').classList.remove('show', 'active');
  }
}

// Toggle debug mode
function toggleDebugMode() {
  const isDebugMode = debugModeCheckbox.checked;
  debugCard.style.display = isDebugMode ? 'block' : 'none';
  localStorage.setItem('debugMode', isDebugMode);
}

// Log debug information
function logDebug(message, data = {}) {
  if (!debugModeCheckbox.checked) return;
  
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    message,
    ...data
  };
  
  console.log(`[DEBUG] ${message}`, data);
  
  const logText = JSON.stringify(logEntry, null, 2);
  debugOutput.textContent = logText + '\n\n' + debugOutput.textContent;
}

// Toggle recording
async function toggleRecording() {
  if (isRecording) {
    stopRecording();
  } else {
    await startRecording();
  }
}

// Start recording
async function startRecording() {
  try {
    statusElement.textContent = 'Requesting microphone access...';
    statusElement.className = 'alert alert-info';
    
    // Request microphone access
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    microphoneStream = stream;
    
    // Set up audio context for visualizing audio levels
    if (!audioContext) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
    }
    
    const source = audioContext.createMediaStreamSource(stream);
    source.connect(analyser);
    
    // Start visualizing audio levels
    visualizeAudio();
    
    // Create MediaRecorder
    mediaRecorder = new MediaRecorder(stream);
    audioChunks = [];
    
    // Collect audio chunks
    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        audioChunks.push(event.data);
      }
    };
    
    // Handle recording stop
    mediaRecorder.onstop = async () => {
      // Stop visualizing audio
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
      }
      
      // Stop microphone stream
      if (microphoneStream) {
        microphoneStream.getTracks().forEach(track => track.stop());
        microphoneStream = null;
      }
      
      statusElement.textContent = 'Processing audio...';
      
      try {
        // Create audio blob and convert to base64
        const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
        const reader = new FileReader();
        
        reader.onload = async (e) => {
          const base64Audio = e.target.result.split(',')[1];
          await sendAudioToApi(base64Audio);
        };
        
        reader.readAsDataURL(audioBlob);
      } catch (error) {
        console.error('Error processing audio:', error);
        statusElement.textContent = `Error: ${error.message}`;
        statusElement.className = 'alert alert-danger';
      }
    };
    
    // Start recording
    mediaRecorder.start();
    isRecording = true;
    recordButton.textContent = 'Stop Recording';
    recordButton.classList.add('recording');
    statusElement.textContent = 'Recording... (click Stop when done)';
    
    logDebug('Recording started');
    
  } catch (error) {
    console.error('Error starting recording:', error);
    statusElement.textContent = `Error: ${error.message}`;
    statusElement.className = 'alert alert-danger';
    logDebug('Recording error', { error: error.message });
  }
}

// Stop recording
function stopRecording() {
  if (mediaRecorder && isRecording) {
    mediaRecorder.stop();
    isRecording = false;
    recordButton.textContent = 'Start Recording';
    recordButton.classList.remove('recording');
    statusElement.textContent = 'Processing audio...';
    statusElement.className = 'alert alert-info';
    
    logDebug('Recording stopped');
  }
}

// Visualize audio levels
function visualizeAudio() {
  if (!analyser) return;
  
  const bufferLength = analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);
  
  function draw() {
    if (!analyser) return;
    
    animationFrameId = requestAnimationFrame(draw);
    analyser.getByteFrequencyData(dataArray);
    
    // Calculate average level
    let sum = 0;
    for (let i = 0; i < bufferLength; i++) {
      sum += dataArray[i];
    }
    const average = sum / bufferLength;
    
    // Update audio level visualization
    const levelPercentage = Math.min(100, average * 2); // Scale for better visibility
    audioLevelFill.style.width = `${levelPercentage}%`;
  }
  
  draw();
}

// Handle file upload
async function handleFileUpload() {
  let fileInput;
  if (currentApiVersion === 'v1') fileInput = v1FileUpload;
  else if (currentApiVersion === 'v2') fileInput = v2FileUpload;
  else if (currentApiVersion === 'groq') fileInput = groqFileUpload;
  
  if (!fileInput.files.length) {
    statusElement.textContent = 'Please select an audio file first';
    statusElement.className = 'alert alert-warning';
    return;
  }
  
  try {
    const file = fileInput.files[0];
    statusElement.textContent = 'Uploading file...';
    statusElement.className = 'alert alert-info';
    transcriptElement.textContent = 'Processing...';
    confidenceElement.textContent = '';
    
    logDebug('File selected for upload', { 
      name: file.name, 
      type: file.type, 
      size: file.size + ' bytes' 
    });
    
    // Create form data
    const formData = new FormData();
    formData.append('audio', file);
    
    if (currentApiVersion === 'groq') {
      // For Groq API
      formData.append('model', getModel());
      formData.append('apiKey', getApiKey());
      
      // Add language if specified
      if (groqLanguage.value) {
        formData.append('language', groqLanguage.value);
      }
      
      // Add prompt if specified
      if (groqPrompt.value) {
        formData.append('prompt', groqPrompt.value);
      }
      
      logDebug('Preparing Groq file upload', {
        model: getModel(),
        language: groqLanguage.value || 'auto-detect',
        prompt: groqPrompt.value || 'none',
        fileName: file.name
      });
    } else if (currentApiVersion === 'v1') {
      // For V1, add language code directly
      formData.append('languageCode', getLanguageCode());
    } else {
      // For V2, we need to create a properly structured request
      const projectId = v2ProjectId.value;
      const region = v2Region.value;
      const selectedLanguages = getSelectedLanguages();
      
      // Create the proper V2 request structure with all selected languages
      const v2RequestData = {
        recognizer: `projects/${projectId}/locations/${region}/recognizers/_`,
        config: {
          // Include all selected languages for Chirp 2
          language_codes: selectedLanguages,
          model: getModel(),
          features: {
            enable_automatic_punctuation: true
          },
          auto_decoding_config: {}
        }
        // content will be added by the server from the file
      };
      
      // Log the languages being used
      if (selectedLanguages.length > 1 && (getModel() === 'chirp' || getModel() === 'chirp_2' || getModel() === 'chirp_3')) {
        logDebug('Using multiple languages with Chirp for file upload', { 
          languages: selectedLanguages 
        });
      }
      
      // Service account authentication is handled by the backend via HTTP headers
      // We'll pass the service account separately
      if (serviceAccountData) {
        // Add a flag to indicate we're using service account auth
        formData.append('useServiceAccount', 'true');
        // Pass the service account data for authentication
        formData.append('serviceAccount', JSON.stringify(serviceAccountData));
        // The backend will handle authentication properly
        logDebug('Using service account authentication for file upload', { projectId });
      }
      
      // Add the structured request as JSON
      formData.append('requestData', JSON.stringify(v2RequestData));
    }
    formData.append('model', getModel());
    
    // Get API key
    const apiKey = getApiKey();
    if (!apiKey) {
      throw new Error('API key is required');
    }
    
    // Save API key to localStorage
    if (currentApiVersion === 'v1') {
      localStorage.setItem('v1ApiKey', apiKey);
    } else if (currentApiVersion === 'v2') {
      localStorage.setItem('v2ApiKey', apiKey);
    } else if (currentApiVersion === 'groq') {
      localStorage.setItem('groqApiKey', apiKey);
    }
    
    // Create URL with API key
    let uploadUrl;
    
    if (currentApiVersion === 'groq') {
      // For Groq API
      uploadUrl = `/api/groq/speech/upload`;
      // API key is already in the form data
    } else {
      // For Google Speech API (v1 or v2)
      uploadUrl = `/api/speech/${currentApiVersion}/upload?key=${encodeURIComponent(apiKey)}`;
      
      // Add project ID and region for V2 API
      if (currentApiVersion === 'v2') {
        uploadUrl += `&project=${encodeURIComponent(v2ProjectId.value)}&region=${encodeURIComponent(v2Region.value)}`;
      }
    }
    
    logDebug('Uploading file', { url: uploadUrl });
    
    // Send request
    const response = await fetch(uploadUrl, {
      method: 'POST',
      body: formData
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error?.message || `Server error: ${response.status}`);
    }
    
    const data = await response.json();
    logDebug('File upload response', data);
    
    // Process results
    processResults(data);
    
    statusElement.textContent = 'File processed successfully';
    statusElement.className = 'alert alert-success';
  } catch (error) {
    console.error('Error uploading file:', error);
    statusElement.textContent = `Error: ${error.message}`;
    statusElement.className = 'alert alert-danger';
    logDebug('Upload error', error);
  }
}

// Send audio to API
async function sendAudioToApi(base64Audio) {
  try {
    statusElement.textContent = 'Processing audio...';
    statusElement.className = 'alert alert-info';
    
    const apiKey = getApiKey();
    if (!apiKey) {
      statusElement.textContent = 'API key is required';
      statusElement.className = 'alert alert-danger';
      return;
    }
    
    let endpoint, requestBody;
    
    if (currentApiVersion === 'groq') {
      // For Groq API
      endpoint = '/api/groq/speech';
      requestBody = {
        apiKey: apiKey,
        model: getModel(),
        content: base64Audio
      };
      
      // Add language if specified
      if (groqLanguage.value) {
        requestBody.language = groqLanguage.value;
      }
      
      // Add prompt if specified
      if (groqPrompt.value) {
        requestBody.prompt = groqPrompt.value;
      }
    } else {
      // For Google Speech API (v1 or v2)
      endpoint = `/api/speech/${currentApiVersion}`;
      
      if (currentApiVersion === 'v1') {
        // For V1 API, the request structure is simple
        requestBody = {
          languageCode: getLanguageCode(),
          model: getModel(),
          content: base64Audio
        };
      } else {
        // For V2 API, the request structure is different
        const projectId = v2ProjectId.value;
        const region = v2Region.value;
        
        // For Chirp model with multiple languages, we can specify all expected languages
        const languages = getSelectedLanguages();
        
        requestBody = {
          recognizer: `projects/${projectId}/locations/${region}/recognizers/_`,
          config: {
            // Include all selected languages for Chirp 2
            language_codes: languages,
            model: getModel(),
            features: {
              enable_automatic_punctuation: true
            },
            auto_decoding_config: {}
          },
          content: base64Audio
        };
        
        // Log the languages being used
        if (languages.length > 1 && (getModel() === 'chirp' || getModel() === 'chirp_2' || getModel() === 'chirp_3')) {
          logDebug('Using multiple languages with Chirp', { languages });
        }
      }
    }
    
    // Save API key to localStorage
    if (currentApiVersion === 'v1') {
      localStorage.setItem('v1ApiKey', apiKey);
    } else if (currentApiVersion === 'v2') {
      localStorage.setItem('v2ApiKey', apiKey);
      localStorage.setItem('v2ProjectId', v2ProjectId.value);
      localStorage.setItem('v2Region', v2Region.value);
      
      // Save selected languages
      const selectedLanguages = getSelectedLanguages();
      localStorage.setItem('v2SelectedLanguages', JSON.stringify(selectedLanguages));
    } else if (currentApiVersion === 'groq') {
      localStorage.setItem('groqApiKey', apiKey);
    }
    
    logDebug('Sending request to API', { 
      version: currentApiVersion,
      requestBody: {
        ...requestBody,
        audio: requestBody.audio ? { content: '(base64 audio data)' } : undefined,
        content: requestBody.content ? '(base64 audio data)' : undefined
      }
    });
    
    // Send request to our proxy server
    let apiUrl;
    
    if (currentApiVersion === 'groq') {
      // For Groq API
      apiUrl = '/api/groq/speech';
      // API key is already in the request body
    } else {
      // For Google Speech API (v1 or v2)
      apiUrl = `/api/speech/${currentApiVersion}?key=${encodeURIComponent(apiKey)}`;
      
      // Add project ID and region to URL for V2 API
      if (currentApiVersion === 'v2') {
        const projectId = v2ProjectId.value;
        const region = v2Region.value;
        apiUrl += `&project=${projectId}&region=${region}`;
      }
    }
    
    // Create headers
    const headers = {
      'Content-Type': 'application/json'
    };
    
    // Pass service account to backend for authentication
    if (serviceAccountData && currentApiVersion === 'v2') {
      // We need to pass the service account data for authentication
      requestBody.serviceAccount = serviceAccountData;
      logDebug('Passing service account to backend for authentication');
    }
    
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(requestBody)
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error?.message || `Server error: ${response.status}`);
    }
    
    const data = await response.json();
    logDebug('API response', data);
    
    // Process results
    processResults(data);
    
    statusElement.textContent = 'Audio processed successfully';
    statusElement.className = 'alert alert-success';
    
  } catch (error) {
    console.error('Error sending audio to API:', error);
    statusElement.textContent = `Error: ${error.message}`;
    statusElement.className = 'alert alert-danger';
    logDebug('API error', { error: error.message });
  }
}

// Process API results
function processResults(data) {
  if (currentApiVersion === 'groq') {
    // Process Groq API response
    if (data.text) {
      transcriptElement.textContent = data.text;
      
      // Extract confidence if available
      if (data.confidence !== undefined) {
        confidenceElement.textContent = `Confidence: ${(data.confidence * 100).toFixed(2)}%`;
      } else {
        confidenceElement.textContent = '';
      }
    } else {
      transcriptElement.textContent = 'No transcription available';
      confidenceElement.textContent = '';
    }
  } else if (currentApiVersion === 'v1') {
    // Process V1 API response
    if (data.results && data.results.length > 0) {
      const result = data.results[0];
      if (result.alternatives && result.alternatives.length > 0) {
        const transcript = result.alternatives[0].transcript;
        const confidence = result.alternatives[0].confidence;
        
        transcriptElement.textContent = transcript;
        confidenceElement.textContent = `Confidence: ${(confidence * 100).toFixed(2)}%`;
      } else {
        transcriptElement.textContent = 'No transcription available';
        confidenceElement.textContent = '';
      }
    } else {
      transcriptElement.textContent = 'No results returned';
      confidenceElement.textContent = '';
    }
  } else {
    // Process V2 API response
    if (data.results && data.results.length > 0) {
      const transcripts = data.results.map(result => {
        if (result.alternatives && result.alternatives.length > 0) {
          return result.alternatives[0].transcript;
        }
        return '';
      }).filter(t => t).join(' ');
      
      transcriptElement.textContent = transcripts || 'No transcription available';
      
      // Extract confidence if available
      if (data.results[0].alternatives && data.results[0].alternatives.length > 0 && 
          data.results[0].alternatives[0].confidence) {
        const confidence = data.results[0].alternatives[0].confidence;
        confidenceElement.textContent = `Confidence: ${(confidence * 100).toFixed(2)}%`;
      } else {
        confidenceElement.textContent = '';
      }
    } else {
      transcriptElement.textContent = 'No results returned';
      confidenceElement.textContent = '';
    }
  }
}

// Helper functions
function getApiKey() {
  if (currentApiVersion === 'v1') return v1ApiKey.value;
  if (currentApiVersion === 'v2') return v2ApiKey.value;
  if (currentApiVersion === 'groq') return groqApiKey.value;
  return '';
}

function getLanguageCode() {
  return currentApiVersion === 'v1' ? v1Language.value : getSelectedLanguages()[0] || 'en-US';
}

function getSelectedLanguages() {
  if (currentApiVersion === 'v1') {
    return [v1Language.value];
  } else {
    // For V2, get all selected language checkboxes
    const selectedLanguages = [];
    v2LanguageCheckboxes.forEach(checkbox => {
      if (checkbox.checked) {
        selectedLanguages.push(checkbox.value);
      }
    });
    // If nothing selected, default to en-US
    return selectedLanguages.length > 0 ? selectedLanguages : ['en-US'];
  }
}

function getModel() {
  if (currentApiVersion === 'v1') return v1Model.value;
  if (currentApiVersion === 'v2') return v2Model.value;
  if (currentApiVersion === 'groq') return groqModel.value;
  return '';
}
