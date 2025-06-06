// DOM Elements
const recordButton = document.getElementById('record-button');
const uploadButton = document.getElementById('upload-button');
const statusElement = document.getElementById('status');
const transcriptElement = document.getElementById('transcript');
const confidenceElement = document.getElementById('confidence');
const debugModeCheckbox = document.getElementById('debug-mode');
const streamingModeCheckbox = document.getElementById('streaming-mode');
const debugCard = document.getElementById('debug-card');
const debugOutput = document.getElementById('debug-output');
const audioLevelFill = document.getElementById('audio-level-fill');

// API Tabs
const googleTab = document.getElementById('google-tab');
const groqTab = document.getElementById('groq-tab');
const azureTab = document.getElementById('azure-tab');

// Groq API Inputs
const groqApiKey = document.getElementById('groq-api-key');
const groqModel = document.getElementById('groq-model');
const groqLanguage = document.getElementById('groq-language');
const groqPrompt = document.getElementById('groq-prompt');
const groqFileUpload = document.getElementById('groq-file-upload');

// Azure API Inputs
const azureApiKeyInput = document.getElementById('azure-api-key');
const azureRegionInput = document.getElementById('azure-region');
const azureLanguageInput = document.getElementById('azure-language');
const azureFileUpload = document.getElementById('azure-file-upload');

// Service account data
let serviceAccountData = null;

// State
let isRecording = false;
let mediaRecorder = null;
let audioChunks = [];
let streamingAudioChunks = [];
let animationFrameId = null;
let audioContext = null;
let analyser = null;
let microphoneStream = null;
let currentApiVersion = 'v1';
let isCurrentlyProcessingStream = false;

// WebSocket and streaming state
let webSocket = null;
let isStreaming = false;
let streamingInterimTranscript = '';

// Get unified Google Speech elements
const googleApiKey = document.getElementById('google-api-key');
const googleServiceAccount = document.getElementById('google-service-account');
const googleProjectId = document.getElementById('google-project-id');
const googleRegion = document.getElementById('google-region');
const googleLanguage = document.getElementById('google-language');
const googleLanguageCheckboxes = document.querySelectorAll('.google-language-checkbox');
const googleModel = document.getElementById('google-model');
const googleFileUpload = document.getElementById('google-file-upload');
const googleV1Radio = document.getElementById('google-v1');
const googleV2Radio = document.getElementById('google-v2');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  // Load saved API keys, project ID and region from localStorage
  const savedV1Key = localStorage.getItem('v1ApiKey');
  const savedV2Key = localStorage.getItem('v2ApiKey');
  const savedV2ProjectId = localStorage.getItem('v2ProjectId');
  const savedV2Region = localStorage.getItem('v2Region');
  const savedGroqKey = localStorage.getItem('groqApiKey');
  
  // Set values from localStorage for the unified Google tab
  if (savedV1Key || savedV2Key) {
    googleApiKey.value = savedV1Key || savedV2Key;
  }
  if (savedV2ProjectId) googleProjectId.value = savedV2ProjectId;
  if (savedV2Region) googleRegion.value = savedV2Region;
  if (savedGroqKey) groqApiKey.value = savedGroqKey;

  const savedAzureKey = localStorage.getItem('azureApiKey');
  const savedAzureRegion = localStorage.getItem('azureRegion');
  const savedAzureLanguage = localStorage.getItem('azureLanguage');
  if (savedAzureKey) azureApiKeyInput.value = savedAzureKey;
  if (savedAzureRegion) azureRegionInput.value = savedAzureRegion;
  if (savedAzureLanguage) azureLanguageInput.value = savedAzureLanguage;
  
  // Load saved language selections for Google V2
  const savedV2Languages = localStorage.getItem('v2SelectedLanguages');
  if (savedV2Languages) {
    try {
      const languages = JSON.parse(savedV2Languages);
      // Uncheck all first
      googleLanguageCheckboxes.forEach(checkbox => checkbox.checked = false);
      // Then check the saved ones
      languages.forEach(lang => {
        const checkbox = document.getElementById(`google-lang-${lang}`);
        if (checkbox) checkbox.checked = true;
      });
    } catch (e) {
      console.error('Error loading saved languages:', e);
    }
  }
  
  // Set up Google API version toggle
  googleV1Radio.addEventListener('change', toggleGoogleApiVersion);
  googleV2Radio.addEventListener('change', toggleGoogleApiVersion);
  azureTab.addEventListener('click', () => setApiVersion('azure'));
  
  // Default to V1 if no version is selected
  if (!googleV1Radio.checked && !googleV2Radio.checked) {
    googleV1Radio.checked = true;
  }
  
  // Initialize the Google API version UI
  toggleGoogleApiVersion();
  
  // Set up event listeners
  recordButton.addEventListener('click', toggleRecording);
  uploadButton.addEventListener('click', () => {
    // Trigger file input click based on active tab
    let fileInput;
    if (currentApiVersion === 'groq') {
      fileInput = groqFileUpload;
    } else if (currentApiVersion === 'azure') {
      fileInput = azureFileUpload;
    } else { // Google V1/V2
      fileInput = googleFileUpload;
    }
    if (fileInput) {
      fileInput.click(); // This will trigger the 'change' event handled by handleFileUpload
    }
  });
  googleFileUpload.addEventListener('change', handleFileUpload);
  azureFileUpload.addEventListener('change', handleFileUpload);
  debugModeCheckbox.addEventListener('change', toggleDebugMode);
  streamingModeCheckbox.addEventListener('change', toggleStreamingMode);
  
  // Initialize tooltips
  const tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
  tooltipTriggerList.map(function (tooltipTriggerEl) {
    return new bootstrap.Tooltip(tooltipTriggerEl);
  });
  
  // API tab switching - now just Google and Groq
  googleTab.addEventListener('click', () => {
    // Keep the current V1/V2 selection when switching to Google tab
    setApiVersion(currentApiVersion === 'groq' ? (googleV1Radio.checked ? 'v1' : 'v2') : currentApiVersion);
  });
  groqTab.addEventListener('click', () => setApiVersion('groq'));
  azureTab.addEventListener('click', () => setApiVersion('azure'));
  
  // Service account file upload for unified Google tab
  googleServiceAccount.addEventListener('change', handleServiceAccountUpload);
  
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
  
  // Azure API input event listeners
  azureApiKeyInput.addEventListener('input', () => localStorage.setItem('azureApiKey', azureApiKeyInput.value));
  azureRegionInput.addEventListener('input', () => localStorage.setItem('azureRegion', azureRegionInput.value));
  azureLanguageInput.addEventListener('change', () => localStorage.setItem('azureLanguage', azureLanguageInput.value));
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
      if (jsonData.project_id && !googleProjectId.value) {
        googleProjectId.value = jsonData.project_id;
        localStorage.setItem('v2ProjectId', jsonData.project_id);
      }
      
      // If we're using V1 API, switch to V2 since service account works better with V2
      if (currentApiVersion === 'v1') {
        googleV2Radio.checked = true;
        toggleGoogleApiVersion();
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
  
  // Update UI for tab selection
  if (version === 'v1' || version === 'v2') {
    // For Google APIs (both V1 and V2)
    googleTab.classList.add('active');
    googleTab.setAttribute('aria-selected', 'true');
    groqTab.classList.remove('active');
    groqTab.setAttribute('aria-selected', 'false');
    azureTab.classList.remove('active');
    azureTab.setAttribute('aria-selected', 'false');
    
    // Show Google content tab
    document.getElementById('google-content').classList.add('show', 'active');
    document.getElementById('groq-content').classList.remove('show', 'active');
    document.getElementById('azure-content').classList.remove('show', 'active');
    
    // Update the radio button selection based on version
    if (version === 'v1') {
      googleV1Radio.checked = true;
    } else {
      googleV2Radio.checked = true;
    }
    
    // Update the UI based on V1/V2 selection
    toggleGoogleApiVersion();
    
  } else if (version === 'groq') {
    // For Groq API
    groqTab.classList.add('active');
    groqTab.setAttribute('aria-selected', 'true');
    googleTab.classList.remove('active');
    googleTab.setAttribute('aria-selected', 'false');
    azureTab.classList.remove('active');
    azureTab.setAttribute('aria-selected', 'false');
    
    // Show Groq content tab
    document.getElementById('groq-content').classList.add('show', 'active');
    document.getElementById('google-content').classList.remove('show', 'active');
    document.getElementById('azure-content').classList.remove('show', 'active');
  } else if (version === 'azure') {
    // For Azure API
    azureTab.classList.add('active');
    azureTab.setAttribute('aria-selected', 'true');
    googleTab.classList.remove('active');
    googleTab.setAttribute('aria-selected', 'false');
    groqTab.classList.remove('active');
    groqTab.setAttribute('aria-selected', 'false');
    
    // Show Azure content tab
    document.getElementById('azure-content').classList.add('show', 'active');
    document.getElementById('google-content').classList.remove('show', 'active');
    document.getElementById('groq-content').classList.remove('show', 'active');
  }
  
  logDebug(`API version set to: ${version}`);
}

// Toggle debug mode
function toggleDebugMode() {
  const isDebugMode = debugModeCheckbox.checked;
  debugCard.style.display = isDebugMode ? 'block' : 'none';
  
  // Clear debug output when turning off debug mode
  if (!isDebugMode) {
    debugOutput.innerHTML = '';
  }
}

// Toggle streaming mode
function toggleStreamingMode() {
  isStreaming = streamingModeCheckbox.checked;
  logDebug(`Streaming mode ${isStreaming ? 'enabled' : 'disabled'}`);
  
  if (isStreaming) {
    // Generate a new session ID for this streaming session
    if (!window.currentStreamSessionId) {
      window.currentStreamSessionId = window.generateSessionId();
    }
    logDebug('New streaming session started', { sessionId: window.currentStreamSessionId });
    connectWebSocket();
  } else if (webSocket) {
    webSocket.close();
    webSocket = null;
    window.currentStreamSessionId = null;
  }
}

// Toggle between Google V1 and V2 API options
function toggleGoogleApiVersion() {
  const isV1 = googleV1Radio.checked;
  const isV2 = googleV2Radio.checked;
  
  // Update current API version
  currentApiVersion = isV1 ? 'v1' : 'v2';
  
  // Show/hide V1-specific elements
  document.querySelectorAll('.v1-only').forEach(el => {
    el.style.display = isV1 ? 'block' : 'none';
  });
  
  // Show/hide V2-specific elements
  document.querySelectorAll('.v2-only').forEach(el => {
    el.style.display = isV2 ? 'block' : 'none';
  });
  
  // Update model options
  if (isV1) {
    // Show only V1 model options
    googleModel.querySelectorAll('optgroup.v1-only').forEach(group => {
      group.style.display = 'block';
    });
    googleModel.querySelectorAll('optgroup.v2-only').forEach(group => {
      group.style.display = 'none';
    });
    // Select first V1 model option
    const firstV1Option = googleModel.querySelector('optgroup.v1-only option');
    if (firstV1Option) firstV1Option.selected = true;
  } else {
    // Show only V2 model options
    googleModel.querySelectorAll('optgroup.v1-only').forEach(group => {
      group.style.display = 'none';
    });
    googleModel.querySelectorAll('optgroup.v2-only').forEach(group => {
      group.style.display = 'block';
    });
    // Select first V2 model option
    const firstV2Option = googleModel.querySelector('optgroup.v2-only option');
    if (firstV2Option) firstV2Option.selected = true;
  }
  
  logDebug(`Switched to Google ${currentApiVersion} API`);
}

// Track if we're currently processing a stream to prevent duplicates
let pendingStreamData = null;

// Connect to WebSocket server
function connectWebSocket() {
  // If we already have an open connection, don't create another one
  if (webSocket && webSocket.readyState === WebSocket.OPEN) {
    logDebug('WebSocket already connected');
    return;
  }
  
  // If we have a connection that's closing, wait for it to close before creating a new one
  if (webSocket && webSocket.readyState === WebSocket.CLOSING) {
    logDebug('WebSocket is closing, waiting before reconnecting...');
    setTimeout(connectWebSocket, 500);
    return;
  }
  
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${wsProtocol}//${window.location.host}`;
  
  logDebug(`Connecting to WebSocket server at ${wsUrl}`);
  
  webSocket = new WebSocket(wsUrl);
  
  webSocket.onopen = () => {
    logDebug('WebSocket connection established');
    
    // If we have pending stream data, send it now
    if (pendingStreamData) {
      logDebug('Sending pending stream data');
      // Attach sessionId
      pendingStreamData.sessionId = window.currentStreamSessionId;
      webSocket.send(JSON.stringify(pendingStreamData));
      pendingStreamData = null;
    }
  };
  
  webSocket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      
      // Enhanced logging for all messages
      if (data.type === 'transcription') {
        // For transcription messages, log with sequence information
        logDebug(`WebSocket message #${data.sequence || 'N/A'} received`, {
          type: data.type,
          isFinal: data.isFinal,
          sequence: data.sequence,
          transcript: data.transcript,
          confidence: data.confidence,
          stability: data.stability,
          alternativesCount: data.alternativesCount,
          resultEndTime: data.resultEndTime
        });
      } else {
        // For other message types
        logDebug('WebSocket message received', data);
      }
      
      if (data.type === 'connected') {
        logDebug('WebSocket connection confirmed');
      } else if (data.type === 'start') {
        // Mark that we're currently processing a stream
        isCurrentlyProcessingStream = true;
        
        // Show processing status when streaming starts
        statusElement.textContent = 'Processing audio...';
        statusElement.className = 'alert alert-info';
        // Clear any previous interim results
        interimResultsElement.textContent = '';
        interimResultsElement.style.display = 'none';
      } else if (data.type === 'transcription') {
        // Keep the "Processing audio..." status while showing interim results
        if (statusElement.textContent !== 'Processing audio...') {
          statusElement.textContent = 'Processing audio...';
          statusElement.className = 'alert alert-info';
        }
        
        // Display sequence and final/interim status in the status area
        const statusInfo = `Processing audio... [Seq: ${data.sequence}, ${data.isFinal ? 'Final' : 'Interim'}]`;
        statusElement.textContent = statusInfo;
        
        // Update transcript with streaming results
        updateStreamingTranscript(data);
      } else if (data.type === 'error') {
        console.error('WebSocket error:', data.message);
        statusElement.textContent = `Error: ${data.message}`;
        statusElement.className = 'alert alert-danger';
        // Hide interim results on error
        interimResultsElement.style.display = 'none';
        
        // Mark that we're no longer processing a stream
        isCurrentlyProcessingStream = false;
      } else if (data.type === 'end') {
        logDebug('Streaming ended');
        // Update status when streaming ends
        statusElement.textContent = 'Transcription complete';
        statusElement.className = 'alert alert-success';
        // Hide interim results when streaming ends
        interimResultsElement.style.display = 'none';
        
        // Mark that we're no longer processing a stream
        isCurrentlyProcessingStream = false;
      }
    } catch (error) {
      console.error('Error parsing WebSocket message:', error);
    }
  };
  
  webSocket.onerror = (error) => {
    console.error('WebSocket error:', error);
    logDebug('WebSocket error', error);
  };
  
  webSocket.onclose = () => {
    logDebug('WebSocket connection closed');
    
    // Attempt to reconnect after a delay if streaming mode is still enabled
    if (isStreaming) {
      setTimeout(() => {
        if (isStreaming) {
          connectWebSocket();
        }
      }, 3000);
    }
  };
}

// Get the interim results element
const interimResultsElement = document.getElementById('interim-results');

// Store recent final transcripts to handle Google's repeated segments
const recentFinalTranscripts = [];
const MAX_RECENT_TRANSCRIPTS = 5;
let fullTranscript = '';

// Update transcript with streaming results
function updateStreamingTranscript(data) {
  const { transcript, isFinal, confidence } = data;
  
  if (isFinal) {
    // Final result - process and update main transcript
    if (transcript.trim()) {
      // Process the final transcript to avoid duplicates and handle overlaps
      const processedResult = processFinalTranscript(transcript);
      
      if (processedResult.isNew) {
        // Update the full transcript with the processed content
        fullTranscript = processedResult.updatedTranscript;
        transcriptElement.textContent = fullTranscript;
        
        // Log the new transcript for debugging
        logDebug('Transcript updated', { 
          new: processedResult.newContent,
          full: fullTranscript 
        });
      } else {
        // This was a duplicate or fully overlapping content - skipped
        logDebug('Skipped duplicate segment', { transcript });
      }
    }
    
    // Update confidence if available
    if (confidence) {
      confidenceElement.textContent = `Confidence: ${(confidence * 100).toFixed(2)}%`;
    }
    
    // Clear the interim transcript when we get a final result
    streamingInterimTranscript = '';
    interimResultsElement.style.display = 'none';
  } else {
    // Interim result - show in the dedicated interim results area
    streamingInterimTranscript = transcript;
    
    // Show the interim results element if it's hidden
    if (interimResultsElement.style.display === 'none') {
      interimResultsElement.style.display = 'block';
    }
    
    // Update the interim results content
    interimResultsElement.textContent = streamingInterimTranscript;
  }
}

// Process a final transcript to handle duplicates and overlaps
function processFinalTranscript(newTranscript) {
  // Check if this exact transcript was recently processed
  if (recentFinalTranscripts.includes(newTranscript)) {
    return { isNew: false };
  }
  
  // Add to recent transcripts and maintain the max length
  recentFinalTranscripts.push(newTranscript);
  if (recentFinalTranscripts.length > MAX_RECENT_TRANSCRIPTS) {
    recentFinalTranscripts.shift();
  }
  
  // If this is the first transcript, just use it directly
  if (!fullTranscript) {
    return { 
      isNew: true, 
      updatedTranscript: newTranscript,
      newContent: newTranscript 
    };
  }
  
  // Check if the new transcript is entirely contained within the full transcript
  if (fullTranscript.includes(newTranscript)) {
    return { isNew: false };
  }
  
  // Check if the new transcript contains the full transcript
  if (newTranscript.includes(fullTranscript)) {
    // The new transcript is a superset of what we have, so replace everything
    return { 
      isNew: true, 
      updatedTranscript: newTranscript,
      newContent: newTranscript.replace(fullTranscript, '') 
    };
  }
  
  // Look for significant overlap at the end of the full transcript
  const maxOverlapLength = Math.min(fullTranscript.length, newTranscript.length) - 1;
  let overlapLength = 0;
  
  for (let i = 1; i <= maxOverlapLength; i++) {
    const endOfFull = fullTranscript.slice(-i);
    const startOfNew = newTranscript.slice(0, i);
    
    if (endOfFull === startOfNew) {
      overlapLength = i;
    }
  }
  
  // If we found significant overlap, append only the non-overlapping part
  if (overlapLength > 0) {
    const nonOverlappingPart = newTranscript.slice(overlapLength);
    if (nonOverlappingPart.trim()) {
      return { 
        isNew: true, 
        updatedTranscript: fullTranscript + nonOverlappingPart,
        newContent: nonOverlappingPart 
      };
    } else {
      return { isNew: false };
    }
  }
  
  // No significant overlap found, append with a space
  return { 
    isNew: true, 
    updatedTranscript: fullTranscript + ' ' + newTranscript,
    newContent: newTranscript 
  };
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
    // Request microphone access
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    microphoneStream = stream;
    
    // Set up audio context for visualization
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioContext.createAnalyser();
    const source = audioContext.createMediaStreamSource(stream);
    source.connect(analyser);
    analyser.fftSize = 256;
    
    // Start audio visualization
    visualizeAudio();
    
    // For Groq streaming, we need to use a format that's well-supported
    // Try to use audio/wav if supported, otherwise fall back to other formats
    let mimeType = 'audio/webm';
    
    // Check for browser support of various audio formats
    if (MediaRecorder.isTypeSupported('audio/wav')) {
      mimeType = 'audio/wav';
    } else if (MediaRecorder.isTypeSupported('audio/mp3')) {
      mimeType = 'audio/mp3';
    } else if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
      mimeType = 'audio/webm;codecs=opus';
    } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
      mimeType = 'audio/mp4';
    }
    
    logDebug(`Using MIME type: ${mimeType} for recording`);
    
    // Create media recorder with high quality settings
    mediaRecorder = new MediaRecorder(stream, {
      mimeType: mimeType,
      audioBitsPerSecond: 256000 // Higher bitrate for better quality
    });
    
    // Handle media recorder data available event
    let streamingChunks = [];
    let lastSentTime = 0;
    const MIN_CHUNK_INTERVAL = 2000; // 2 seconds minimum between sends for Groq
    
    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        // Always collect chunks for non-streaming mode
        audioChunks.push(event.data);
        
        // For streaming mode, also handle real-time streaming
        if (isStreaming && webSocket && webSocket.readyState === WebSocket.OPEN) {
          // Add chunk to streaming collection
          streamingChunks.push(event.data);
          
          const now = Date.now();
          const api = currentApiVersion === 'groq' ? 'groq' : 'google';
          
          // For Google API, send each chunk immediately
          // For Groq API, collect chunks and send less frequently
          // Only send if we're not currently processing a stream
          if (!isCurrentlyProcessingStream && 
              (api === 'google' || (api === 'groq' && now - lastSentTime >= MIN_CHUNK_INTERVAL))) {
            // Create a combined blob from all chunks
            const audioBlob = new Blob(streamingChunks, { type: mediaRecorder.mimeType });
            
            // Convert blob to base64
            const reader = new FileReader();
            reader.onloadend = () => {
              const base64Audio = reader.result.split(',')[1];
              
              // Send audio chunk to WebSocket server
              const streamData = {
                type: 'start_stream',
                api: api,
                apiKey: getApiKey(),
                content: base64Audio,
                model: getModel(),
                languageCode: getLanguageCode(),
                language: currentApiVersion === 'groq' ? groqLanguage.value : null,
                prompt: currentApiVersion === 'groq' ? groqPrompt.value : null,
                fileType: mediaRecorder.mimeType,
                fileName: `recording.${mediaRecorder.mimeType.split('/')[1].split(';')[0]}`
              };
              
              // Add service account data if available for Google
              if (api === 'google' && serviceAccountData) {
                streamData.serviceAccount = serviceAccountData;
              }
              
              // Add sessionId
              streamData.sessionId = window.currentStreamSessionId;
              
              webSocket.send(JSON.stringify(streamData));
              
              // If Groq, clear streaming chunks after sending
              if (api === 'groq') {
                streamingChunks = [];
                lastSentTime = now;
              }
            };
            
            reader.readAsDataURL(audioBlob);
          }
        }
      }
    };
    
    // Handle media recorder stop event
    mediaRecorder.onstop = async () => {
      statusElement.textContent = 'Processing audio...';
      statusElement.className = 'alert alert-info';
      
      // Create blob from audio chunks
      const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
      audioChunks = [];
      
      // If not in streaming mode, send the complete audio to the API
      if (!isStreaming) {
        // Convert blob to base64
        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = async () => {
          const base64Audio = reader.result.split(',')[1];
          await sendAudioToApi(base64Audio);
        };
      }
    };
    
    // Start recording
    mediaRecorder.start(1000); // Capture in 1-second chunks
    isRecording = true;
    
    // Update UI
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
  if (currentApiVersion === 'groq') {
    fileInput = groqFileUpload;
  } else if (currentApiVersion === 'azure') {
    fileInput = azureFileUpload;
  } else {
    // For Google (both V1 and V2)
    fileInput = googleFileUpload;
  }
  
  if (!fileInput.files.length) {
    statusElement.textContent = 'Please select an audio file first';
    statusElement.className = 'alert alert-warning';
    return;
  }
  
  // Clear transcript before processing new file
  transcriptElement.textContent = '';
  confidenceElement.textContent = '';
  
  // Clear any previous interim results
  interimResultsElement.textContent = '';
  interimResultsElement.style.display = 'none';
  
  // If in streaming mode, we need to handle the file differently
  if (isStreaming && webSocket && webSocket.readyState === WebSocket.OPEN) {
    try {
      const file = fileInput.files[0];
      statusElement.textContent = 'Streaming file...';
      statusElement.className = 'alert alert-info';
      
      // Get file information for better format handling
      const fileType = file.type || 'audio/webm';
      const fileName = file.name || 'audio.webm';
      
      logDebug(`Streaming file: ${fileName}, type: ${fileType}`);
      
      // Read file as base64
      const reader = new FileReader();
      reader.onload = () => {
        const base64Audio = reader.result.split(',')[1];
        
        // Prepare data for WebSocket server streaming
        const streamData = {
          type: 'start_stream',
          api: currentApiVersion, // Pass the actual version (v1, v2, or groq)
          apiKey: getApiKey(),
          content: base64Audio,
          model: getModel(),
          languageCode: getLanguageCode(),
          language: currentApiVersion === 'groq' ? groqLanguage.value : null,
          prompt: currentApiVersion === 'groq' ? groqPrompt.value : null,
          fileType: fileType,
          fileName: fileName
        };
        
        // Add service account data if available for Google
        if ((currentApiVersion === 'v1' || currentApiVersion === 'v2') && serviceAccountData) {
          streamData.serviceAccount = serviceAccountData;
        }
        
        // Add sessionId
        streamData.sessionId = window.currentStreamSessionId;
        
        // Send to WebSocket server for streaming
        webSocket.send(JSON.stringify(streamData));
        
        logDebug('Sent file to WebSocket server for streaming transcription');
      };
      reader.readAsDataURL(file);
      
      // Add streaming styles if not already added
      if (!document.getElementById('streaming-styles')) {
        const styleEl = document.createElement('style');
        styleEl.id = 'streaming-styles';
        styleEl.textContent = `
          .interim-transcript { color: gray; }
          .final-transcript { color: black; }
        `;
        document.head.appendChild(styleEl);
      }
      
      return; // Don't proceed with normal file upload
    } catch (error) {
      console.error('Error streaming file:', error);
      statusElement.textContent = `Error: ${error.message}`;
      statusElement.className = 'alert alert-danger';
      return;
    }
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

    const currentKey = getApiKey(); // Centralized API key retrieval
    if (!currentKey && !(currentApiVersion === 'v2' && getServiceAccountData())) {
      // Allow V2 with service account to proceed without an API key input
      statusElement.textContent = 'API key is required.';
      statusElement.className = 'alert alert-danger';
      return;
    }

    let apiUrl, params = {}, body = {};

    if (currentApiVersion === 'azure') {
      if (!azureRegionInput.value) {
        statusElement.textContent = 'Azure Region is required.';
        statusElement.className = 'alert alert-danger';
        return;
      }
      apiUrl = '/api/azure/speech';
      // Azure key and region are passed in query for the backend proxy to use in headers to Azure
      params = {
        key: currentKey,
        region: azureRegionInput.value
      };
      // Body for Azure includes content and other details for the proxy's reference or direct use if designed so
      body = {
        apiKey: currentKey, 
        region: azureRegionInput.value,
        language: getLanguageCode(),
        content: base64Audio
      };
    } else if (currentApiVersion === 'groq') {
      apiUrl = '/api/groq/speech';
      // Groq API key can be in query or body; backend server.js checks both.
      // For simplicity here, backend primarily uses query.key for auth check, but include in body too.
      params = { key: currentKey }; 
      body = {
        apiKey: currentKey,
        model: getModel(),
        language: getLanguageCode() || null, // Groq language is optional
        prompt: groqPrompt.value || null,   // Groq prompt is optional
        content: base64Audio
      };
    } else { // Google V1 or V2
      apiUrl = `/api/speech/${currentApiVersion}`;
      // Google API Key in query for auth if not using service account
      // If service account is used, key might be undefined, and backend handles auth with service account.
      if (currentKey) {
        params = { key: currentKey }; 
      }
      
      body = {
        apiKey: currentKey, // Also in body for consistency or if backend prefers, server.js handles it
        content: base64Audio,
        model: getModel(),
        serviceAccount: getServiceAccountData() // Will be null if not provided
      };

      if (currentApiVersion === 'v1') {
        body.languageCode = getLanguageCode();
      } else { // V2
        body.projectId = googleProjectId.value || (getServiceAccountData() ? getServiceAccountData().project_id : null);
        body.region = googleRegion.value;
        body.languageCodes = getSelectedLanguages(); // For V2, pass multiple languages
        
        // Backend /api/speech/v2 handles constructing the full recognizer path and config structure.
        // Frontend just needs to ensure Project ID is available if using service account without a global API key.
        if (!body.projectId && !params.key && !body.serviceAccount) { 
          statusElement.textContent = 'Google Project ID is required for V2 API when not using API key or service account.';
          statusElement.className = 'alert alert-danger';
          return;
        }
      }
    }

    logDebug(`Sending audio to ${currentApiVersion} API`, { apiUrl: apiUrl, params: params, body: body });

    const queryString = new URLSearchParams(params).toString();
    const fullUrl = queryString ? `${apiUrl}?${queryString}` : apiUrl;

    const response = await fetch(fullUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      // Try to parse JSON error, otherwise use status text
      const errorText = await response.text(); // Get raw text first
      let errorData;
      try {
        errorData = JSON.parse(errorText);
      } catch (e) {
        errorData = { error: { message: `Server error: ${response.statusText} (${response.status}) - ${errorText}` } };
      }
      throw new Error(errorData.error?.message || `Server error: ${response.statusText} (${response.status})`);
    }

    const data = await response.json();
    logDebug('API response', data);

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
  if (currentApiVersion === 'azure') {
    // Process Azure API response
    if (data.RecognitionStatus === 'Success' && data.DisplayText) {
      transcriptElement.textContent = data.DisplayText;
      if (data.NBest && data.NBest.length > 0 && data.NBest[0].Confidence !== undefined) {
        confidenceElement.textContent = `Confidence: ${(data.NBest[0].Confidence * 100).toFixed(2)}%`;
      } else {
        confidenceElement.textContent = 'Confidence: N/A'; // Azure might not always provide confidence
      }
    } else {
      transcriptElement.textContent = data.DisplayText || (data.error ? data.error.message : 'No transcription available or error occurred.');
      confidenceElement.textContent = '';
      logDebug('Azure API Error or Unsuccessful Recognition', data);
    }
  } else if (currentApiVersion === 'groq') {
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
  if (currentApiVersion === 'groq') {
    return groqApiKey.value;
  } else if (currentApiVersion === 'azure') {
    return azureApiKeyInput.value;
  } else {
    // For Google (both V1 and V2)
    return googleApiKey.value;
  }
}

function getLanguageCode() {
  if (currentApiVersion === 'groq') {
    return groqLanguage.value || 'en';
  } else if (currentApiVersion === 'azure') {
    return azureLanguageInput.value || 'en-US';
  } else if (currentApiVersion === 'v1') {
    return googleLanguage.value || 'en-US';
  } else {
    // For V2, get the first selected language or default to en-US
    return getSelectedLanguages()[0] || 'en-US';
  }
}

function getSelectedLanguages() {
  if (currentApiVersion === 'groq') {
    return [groqLanguage.value || 'en'];
  } else if (currentApiVersion === 'azure') {
    return [azureLanguageInput.value || 'en-US']; 
  } else if (currentApiVersion === 'v1') {
    return [googleLanguage.value || 'en-US'];
  } else {
    // For V2, get all selected language checkboxes
    const selectedLanguages = [];
    googleLanguageCheckboxes.forEach(checkbox => {
      if (checkbox.checked) {
        selectedLanguages.push(checkbox.value);
      }
    });
    // If nothing selected, default to en-US
    return selectedLanguages.length > 0 ? selectedLanguages : ['en-US'];
  }
}

function getModel() {
  if (currentApiVersion === 'groq') {
    return groqModel.value;
  } else if (currentApiVersion === 'azure') {
    return null; // Azure doesn't have a model selection in this UI yet
  } else {
    // For Google (both V1 and V2)
    return googleModel.value;
  }
}

// Get service account data
function getServiceAccountData() {
  if (currentApiVersion === 'groq' || currentApiVersion === 'azure' || !googleServiceAccount.files || googleServiceAccount.files.length === 0) {
    return null;
  }
  return serviceAccountData;
}
