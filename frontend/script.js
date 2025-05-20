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
  
  if (savedV1Key) v1ApiKey.value = savedV1Key;
  if (savedV2Key) v2ApiKey.value = savedV2Key;
  if (savedV2ProjectId) v2ProjectId.value = savedV2ProjectId;
  if (savedV2Region) v2Region.value = savedV2Region;
  
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
  debugModeCheckbox.addEventListener('change', toggleDebugMode);
  
  // Handle service account file upload
  v2ServiceAccount.addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = function(e) {
        try {
          serviceAccountData = JSON.parse(e.target.result);
          logDebug('Service account loaded', { 
            type: serviceAccountData.type,
            project_id: serviceAccountData.project_id 
          });
          // If the service account has a project_id, use it
          if (serviceAccountData.project_id && !v2ProjectId.value) {
            v2ProjectId.value = serviceAccountData.project_id;
            localStorage.setItem('v2ProjectId', serviceAccountData.project_id);
          }
        } catch (error) {
          console.error('Error parsing service account JSON:', error);
          logDebug('Error parsing service account JSON', error);
          serviceAccountData = null;
        }
      };
      reader.readAsText(file);
    } else {
      serviceAccountData = null;
    }
  });
  
  // Tab switching
  v1Tab.addEventListener('click', () => setApiVersion('v1'));
  v2Tab.addEventListener('click', () => setApiVersion('v2'));
  
  // Save API keys when changed
  v1ApiKey.addEventListener('change', () => {
    localStorage.setItem('v1ApiKey', v1ApiKey.value);
  });
  
  v2ApiKey.addEventListener('change', () => {
    localStorage.setItem('v2ApiKey', v2ApiKey.value);
  });
});

// Set the active API version
function setApiVersion(version) {
  currentApiVersion = version;
}

// Toggle debug mode
function toggleDebugMode() {
  if (debugModeCheckbox.checked) {
    debugCard.style.display = 'block';
  } else {
    debugCard.style.display = 'none';
  }
}

// Log debug information
function logDebug(message, data = null) {
  if (!debugModeCheckbox.checked) return;
  
  const timestamp = new Date().toISOString();
  let logMessage = `[${timestamp}] ${message}`;
  
  if (data) {
    if (typeof data === 'object') {
      logMessage += '\n' + JSON.stringify(data, null, 2);
    } else {
      logMessage += '\n' + data;
    }
  }
  
  debugOutput.textContent = logMessage + '\n\n' + debugOutput.textContent;
}

// Toggle recording state
async function toggleRecording() {
  if (isRecording) {
    stopRecording();
  } else {
    await startRecording();
  }
}

// Start recording audio
async function startRecording() {
  try {
    // Reset state
    audioChunks = [];
    transcriptElement.textContent = 'Listening...';
    confidenceElement.textContent = '';
    
    // Get microphone access
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    microphoneStream = stream;
    
    // Set up audio context for visualization
    if (!audioContext) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
    }
    
    const source = audioContext.createMediaStreamSource(stream);
    source.connect(analyser);
    
    // Start visualization
    visualizeAudio();
    
    // Set up media recorder
    mediaRecorder = new MediaRecorder(stream);
    
    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        audioChunks.push(event.data);
      }
    };
    
    mediaRecorder.onstop = () => {
      processAudio();
    };
    
    // Start recording
    mediaRecorder.start();
    isRecording = true;
    recordButton.textContent = 'Stop Recording';
    recordButton.classList.add('recording');
    statusElement.textContent = 'Recording...';
    statusElement.className = 'alert alert-danger';
    
    logDebug('Recording started');
  } catch (error) {
    console.error('Error starting recording:', error);
    statusElement.textContent = `Error: ${error.message}`;
    statusElement.className = 'alert alert-danger';
    logDebug('Recording error', error);
  }
}

// Stop recording audio
function stopRecording() {
  if (mediaRecorder && isRecording) {
    mediaRecorder.stop();
    isRecording = false;
    recordButton.textContent = 'Start Recording';
    recordButton.classList.remove('recording');
    statusElement.textContent = 'Processing audio...';
    statusElement.className = 'alert alert-info';
    
    // Stop visualization
    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
    
    // Stop microphone stream
    if (microphoneStream) {
      microphoneStream.getTracks().forEach(track => track.stop());
      microphoneStream = null;
    }
    
    logDebug('Recording stopped');
  }
}

// Process recorded audio
async function processAudio() {
  try {
    statusElement.textContent = 'Converting audio...';
    
    // Create audio blob
    const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
    logDebug('Audio blob created', { size: audioBlob.size + ' bytes', type: audioBlob.type });
    
    // Convert to base64
    const base64Audio = await blobToBase64(audioBlob);
    logDebug('Audio converted to base64', { length: base64Audio.length + ' characters' });
    
    // Send to API
    await sendAudioToApi(base64Audio);
  } catch (error) {
    console.error('Error processing audio:', error);
    statusElement.textContent = `Error: ${error.message}`;
    statusElement.className = 'alert alert-danger';
    logDebug('Processing error', error);
  }
}

// Convert blob to base64
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      // Extract the base64 data from the result
      const base64Data = reader.result.split(',')[1];
      resolve(base64Data);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// Handle file upload
async function handleFileUpload() {
  const fileInput = currentApiVersion === 'v1' ? v1FileUpload : v2FileUpload;
  
  if (!fileInput.files || fileInput.files.length === 0) {
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
    // For V1, add language code directly
    if (currentApiVersion === 'v1') {
      formData.append('languageCode', getLanguageCode());
    } else {
      // For V2, we need to create a properly structured request
      const projectId = v2ProjectId.value;
      const region = v2Region.value;
      const selectedLanguages = getSelectedLanguages();
      
      // Create the proper V2 request structure
      const v2RequestData = {
        recognizer: `projects/${projectId}/locations/${region}/recognizers/_`,
        config: {
          language_codes: selectedLanguages,
          model: getModel(),
          auto_decoding_config: {}
        }
        // content will be added by the server from the file
      };
      
      // If service account file is provided, include it in the request
      if (serviceAccountData) {
        v2RequestData.serviceAccount = serviceAccountData;
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
    
    // Send to server
    const response = await fetch(`/api/speech/${currentApiVersion}/upload?key=${apiKey}`, {
      method: 'POST',
      body: formData
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error?.message || `Server error: ${response.status}`);
    }
    
    const data = await response.json();
    logDebug('API response', data);
    
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
    statusElement.textContent = 'Sending to Google Speech API...';
    
    // Get API key
    const apiKey = getApiKey();
    if (!apiKey) {
      throw new Error('API key is required');
    }
    
    // Create request body based on API version
    let requestBody;
    if (currentApiVersion === 'v1') {
      requestBody = {
        model: getModel(),
        audio: {
          content: base64Audio
        }
      };
      requestBody.languageCode = getLanguageCode();
    } else {
      // For V2 API, the request structure is different
      const projectId = v2ProjectId.value;
      const region = v2Region.value;
      
      requestBody = {
        recognizer: `projects/${projectId}/locations/${region}/recognizers/_`,
        config: {
          language_codes: getSelectedLanguages(),
          model: getModel(),
          auto_decoding_config: {}
        },
        content: base64Audio
      };
      
      // If service account file is provided, include it in the request
      if (serviceAccountData) {
        requestBody.serviceAccount = serviceAccountData;
        logDebug('Using service account authentication', { projectId });
      }
      
      // Save project ID and region to localStorage
      localStorage.setItem('v2ProjectId', v2ProjectId.value);
      localStorage.setItem('v2Region', v2Region.value);
      
      // Save selected languages
      const selectedLanguages = getSelectedLanguages();
      localStorage.setItem('v2SelectedLanguages', JSON.stringify(selectedLanguages));
    }
    
    logDebug('Sending request to API', { 
      version: currentApiVersion,
      url: `/api/speech/${currentApiVersion}?key=${apiKey}`,
      requestBody: {
        ...requestBody,
        audio: requestBody.audio ? { content: '(base64 audio data)' } : undefined,
        content: requestBody.content ? '(base64 audio data)' : undefined
      }
    });
    
    // Send request to our proxy server
    let apiUrl = `/api/speech/${currentApiVersion}?key=${apiKey}`;
    
    // Add project ID and region to URL for V2 API
    if (currentApiVersion === 'v2') {
      const projectId = v2ProjectId.value;
      const region = v2Region.value;
      apiUrl += `&project=${projectId}&region=${region}`;
    }
    
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });
    
    const data = await response.json();
    
    // Check if there's an error in the response
    if (data.error) {
      throw new Error(data.error.message || `API error: ${data.error.code || 'unknown'}`);
    }
    
    logDebug('API response', data);
    
    // Process results
    processResults(data);
    
    statusElement.textContent = 'Speech recognition completed';
    statusElement.className = 'alert alert-success';
  } catch (error) {
    console.error('API error:', error);
    statusElement.textContent = `Error: ${error.message}`;
    statusElement.className = 'alert alert-danger';
    logDebug('API error', error);
  }
}

// Process API results
function processResults(data) {
  if (currentApiVersion === 'v1') {
    processV1Results(data);
  } else {
    processV2Results(data);
  }
}

// Process V1 API results
function processV1Results(data) {
  if (!data.results || data.results.length === 0) {
    transcriptElement.textContent = 'No speech detected';
    confidenceElement.textContent = '';
    return;
  }
  
  let transcript = '';
  let confidence = 0;
  let resultCount = 0;
  
  data.results.forEach(result => {
    if (result.alternatives && result.alternatives.length > 0) {
      transcript += result.alternatives[0].transcript + ' ';
      confidence += result.alternatives[0].confidence || 0;
      resultCount++;
    }
  });
  
  if (resultCount > 0) {
    const avgConfidence = confidence / resultCount;
    transcriptElement.textContent = transcript.trim();
    confidenceElement.textContent = `Confidence: ${(avgConfidence * 100).toFixed(2)}%`;
  } else {
    transcriptElement.textContent = 'No speech detected';
    confidenceElement.textContent = '';
  }
}

// Process V2 API results
function processV2Results(data) {
  if (!data.results || data.results.length === 0) {
    transcriptElement.textContent = 'No speech detected';
    confidenceElement.textContent = '';
    return;
  }
  
  let transcript = '';
  let confidence = 0;
  let resultCount = 0;
  
  data.results.forEach(result => {
    if (result.alternatives && result.alternatives.length > 0) {
      transcript += result.alternatives[0].transcript + ' ';
      // V2 API might have different confidence structure
      if (result.alternatives[0].confidence) {
        confidence += result.alternatives[0].confidence;
        resultCount++;
      }
    }
  });
  
  transcriptElement.textContent = transcript.trim();
  
  if (resultCount > 0) {
    const avgConfidence = confidence / resultCount;
    confidenceElement.textContent = `Confidence: ${(avgConfidence * 100).toFixed(2)}%`;
  } else {
    confidenceElement.textContent = '';
  }
}

// Helper functions
function getApiKey() {
  return currentApiVersion === 'v1' ? v1ApiKey.value : v2ApiKey.value;
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
  return currentApiVersion === 'v1' ? v1Model.value : v2Model.value;
}

// Visualize audio levels
function visualizeAudio() {
  if (!analyser) return;
  
  const dataArray = new Uint8Array(analyser.frequencyBinCount);
  
  const updateVisualization = () => {
    analyser.getByteFrequencyData(dataArray);
    
    // Calculate average volume
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
      sum += dataArray[i];
    }
    const average = sum / dataArray.length;
    
    // Update visualization
    const percent = (average / 255) * 100;
    audioLevelFill.style.width = `${percent}%`;
    
    // Continue animation
    animationFrameId = requestAnimationFrame(updateVisualization);
  };
  
  updateVisualization();
}

// Check server health on load
fetch('/health')
  .then(response => response.json())
  .then(data => {
    logDebug('Server health check', data);
    statusElement.textContent = `Ready to test (Proxy: ${data.proxy})`;
  })
  .catch(error => {
    console.error('Server health check failed:', error);
    statusElement.textContent = 'Error: Backend server not available';
    statusElement.className = 'alert alert-danger';
    logDebug('Server health check failed', error);
  });
