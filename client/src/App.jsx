import { useState, useEffect, useRef } from 'react'
import io from 'socket.io-client'
import SimplePeer from 'simple-peer'
import { Video, Mic, MicOff, VideoOff, Send, SkipForward } from 'lucide-react'
import './index.css'

// Connect to same host/port as served or proxy
const socket = io('/', {
  path: '/socket.io/',
  reconnection: true
})

function App() {
  const [stream, setStream] = useState(null)
  const [me, setMe] = useState('')
  const [roomId, setRoomId] = useState(null)
  const [searching, setSearching] = useState(false)
  const [callAccepted, setCallAccepted] = useState(false)
  const [callEnded, setCallEnded] = useState(false)
  const [myVideoStatus, setMyVideoStatus] = useState(true)
  const [myMicStatus, setMyMicStatus] = useState(true)
  const [messages, setMessages] = useState([])
  const [messageInput, setMessageInput] = useState('')
  const [partnerConnected, setPartnerConnected] = useState(false)

  const myVideo = useRef()
  const userVideo = useRef()
  const connectionRef = useRef()
  const roomIdRef = useRef(null)
  const streamRef = useRef(null)
  const chatScrollRef = useRef(null)

  useEffect(() => {
    roomIdRef.current = roomId
    // Auto scroll chat
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight
    }
  }, [roomId, messages])

  useEffect(() => {
    navigator.mediaDevices.getUserMedia({ video: true, audio: true }).then((currentStream) => {
      setStream(currentStream)
      streamRef.current = currentStream
      if (myVideo.current) myVideo.current.srcObject = currentStream
    }).catch(err => {
      console.error("Failed to get stream", err)
      alert("Impossibile accedere a camera o microfono.")
    })

    socket.on('connect', () => {
      setMe(socket.id)
    })

    socket.on('match_found', ({ roomId: room }) => {
      setSearching(false)
      setRoomId(room)
      setMessages([])
      setCallEnded(false)
      setCallAccepted(true)
      setPartnerConnected(true)
    })

    socket.on('partner_left', () => {
      handlePartnerDisconnect()
    })

    // Cleanup
    return () => {
      socket.off('connect')
      socket.off('match_found')
      socket.off('partner_left')
    }
  }, [])

  // Peer initialization effect
  useEffect(() => {
    if (!stream) return;

    const handleRole = (role) => {
      console.log("Received role:", role)
      // Cleanup old peer if any
      if (connectionRef.current) {
        try { connectionRef.current.destroy() } catch (e) { }
      }

      const peer = new SimplePeer({
        initiator: role === 'initiator',
        trickle: false,
        stream: stream
      })

      peer.on('signal', (data) => {
        socket.emit('signal', {
          room: roomIdRef.current,
          type: 'signal',
          payload: data
        })
      })

      peer.on('stream', (remoteStream) => {
        if (userVideo.current) userVideo.current.srcObject = remoteStream
      })

      peer.on('data', (data) => {
        const text = new TextDecoder().decode(data)
        setMessages(prev => [...prev, { text, sender: 'partner', id: Date.now() }])
      })

      peer.on('close', () => {
        handlePartnerDisconnect()
      })

      peer.on('error', (err) => {
        console.error("Peer error:", err)
      })

      connectionRef.current = peer
    }

    const handleSignal = (data) => {
      if (connectionRef.current && !connectionRef.current.destroyed) {
        connectionRef.current.signal(data.payload)
      }
    }

    socket.on('role', handleRole)
    socket.on('signal', handleSignal)

    return () => {
      socket.off('role', handleRole)
      socket.off('signal', handleSignal)
      if (connectionRef.current) {
        try { connectionRef.current.destroy() } catch (e) { }
      }
    }
  }, [stream])

  function handlePartnerDisconnect() {
    setCallEnded(true)
    setPartnerConnected(false)
    setMessages(prev => [...prev, { text: "Il partner si è disconnesso.", sender: 'system' }])
    setRoomId(null)
  }

  function handleNext() {
    // 1. Clean up local state
    setSearching(true)
    setCallAccepted(false)
    setPartnerConnected(false)
    setMessages([])
    setRoomId(null)

    // 2. Notify server to leave current room
    if (roomIdRef.current) {
      socket.emit('leave_room', roomIdRef.current)
    }

    // 3. Destroy peer
    if (connectionRef.current) {
      try { connectionRef.current.destroy() } catch (e) { }
    }

    // 4. Request new partner
    socket.emit('find_partner')
  }

  function handleStop() {
    if (roomIdRef.current) socket.emit('leave_room', roomIdRef.current)
    if (connectionRef.current) {
      try { connectionRef.current.destroy() } catch (e) { }
    }
    setSearching(false)
    setRoomId(null)
    setCallAccepted(false)
    setPartnerConnected(false)
    setMessages([])
  }

  function startSearch() {
    setSearching(true)
    socket.emit('find_partner')
  }

  function sendMessage() {
    if (!messageInput.trim()) return;

    if (connectionRef.current && partnerConnected) {
      try {
        connectionRef.current.send(messageInput)
        setMessages(prev => [...prev, { text: messageInput, sender: 'me' }])
        setMessageInput('')
      } catch (err) {
        console.error("Msg send error", err)
      }
    }
  }

  function toggleVideo() {
    const track = stream.getVideoTracks()[0]
    track.enabled = !track.enabled
    setMyVideoStatus(track.enabled)
  }

  function toggleAudio() {
    const track = stream.getAudioTracks()[0]
    track.enabled = !track.enabled
    setMyMicStatus(track.enabled)
  }

  return (
    <div className="app-container">
      <header className="header">
        <h1>Grenmegle <span className="beta-tag">BETA</span></h1>
        <div className="status">
          {searching ? <span className="status-searching">Cercando partner...</span> :
            roomId ? <span className="status-connected">Connesso</span> :
              <span className="status-idle">In attesa</span>}
        </div>
      </header>

      <main className="main-content">
        <div className="video-grid">
          <div className="video-wrapper local">
            <video playsInline muted ref={myVideo} autoPlay />
            <div className="video-label">Tu</div>
            <div className="controls-overlay">
              <button onClick={toggleVideo} className={`icon-btn ${!myVideoStatus ? 'off' : ''}`}>
                {myVideoStatus ? <Video size={20} /> : <VideoOff size={20} />}
              </button>
              <button onClick={toggleAudio} className={`icon-btn ${!myMicStatus ? 'off' : ''}`}>
                {myMicStatus ? <Mic size={20} /> : <MicOff size={20} />}
              </button>
            </div>
          </div>

          <div className="video-wrapper remote">
            {partnerConnected ? (
              <video playsInline ref={userVideo} autoPlay />
            ) : (
              <div className="placeholder">
                {searching ?
                  <div className="searching-container">
                    <div className="loader"></div>
                    <p>Ricerca in corso...</p>
                  </div>
                  : <div className="logo-placeholder">
                    {!callEnded ? "Premi START" : "Chat terminata"}
                  </div>
                }
              </div>
            )}
            {partnerConnected && <div className="video-label">Sconosciuto</div>}
          </div>
        </div>

        <div className="chat-container">
          <div className="chat-messages" ref={chatScrollRef}>
            {messages.length === 0 && !searching && !roomId && (
              <div className="message system">Premi START per cercare un partner.</div>
            )}
            {messages.map((msg, i) => (
              <div key={i} className={`message ${msg.sender === 'me' ? 'me' : msg.sender === 'system' ? 'system' : 'partner'}`}>
                {msg.text}
              </div>
            ))}
          </div>
          <div className="chat-input-area">
            <input
              type="text"
              placeholder="Scrivi un messaggio..."
              value={messageInput}
              onChange={(e) => setMessageInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
              disabled={!partnerConnected}
            />
            <button onClick={sendMessage} disabled={!partnerConnected}><Send size={20} /></button>
          </div>
        </div>
      </main>

      <footer className="footer-controls">
        <button className="control-btn stop" onClick={handleStop} disabled={!searching && !roomId}>
          Stop
        </button>
        <button className="control-btn next" onClick={startSearch} disabled={searching || roomId}>
          Start
        </button>
        <button className="control-btn next" onClick={handleNext} disabled={!roomId}>
          Next <SkipForward size={24} />
        </button>
      </footer>
    </div>
  )
}

export default App
