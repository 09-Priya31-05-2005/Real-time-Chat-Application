import { WebSocketServer } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { createServer } from 'http';

const PORT = 8080;

// In-memory storage
const messages = [];
const users = new Map();
const typingUsers = new Set();

// Generate avatar URL based on username
function generateAvatar(username) {
  const avatarId = Math.abs(username.split('').reduce((a, b) => {
    a = ((a << 5) - a) + b.charCodeAt(0);
    return a & a;
  }, 0)) % 100;
  
  return `https://images.pexels.com/photos/${1000 + avatarId}/pexels-photo-${1000 + avatarId}.jpeg?auto=compress&cs=tinysrgb&w=64&h=64&fit=crop&crop=face`;
}

// Broadcast to all connected clients
function broadcast(message, excludeWs = null) {
  wss.clients.forEach(client => {
    if (client !== excludeWs && client.readyState === client.OPEN) {
      client.send(JSON.stringify(message));
    }
  });
}

// Create HTTP server first
const server = createServer();

// Create WebSocket server attached to HTTP server
const wss = new WebSocketServer({ 
  server,
  perMessageDeflate: false
});

// Start the server
server.listen(PORT, () => {
  console.log(`🚀 WebSocket server running on ws://localhost:${PORT}`);
});

// Handle server errors
server.on('error', (error) => {
  console.error('Server error:', error);
});

wss.on('connection', (ws) => {
  console.log('New client connected');
  
  // Send a ping to keep connection alive
  const pingInterval = setInterval(() => {
    if (ws.readyState === ws.OPEN) {
      ws.ping();
    }
  }, 30000);
  
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      
      switch (message.type) {
        case 'join':
          const userId = uuidv4();
          const user = {
            id: userId,
            username: message.data.username,
            avatar: generateAvatar(message.data.username),
            isOnline: true,
            lastSeen: Date.now()
          };
          
          users.set(ws, user);
          
          // Send current user and user list to the new client
          ws.send(JSON.stringify({
            type: 'user_list',
            data: {
              currentUser: user,
              users: Array.from(users.values())
            },
            timestamp: Date.now()
          }));
          
          // Send recent message history to new user
          messages.slice(-50).forEach(msg => {
            ws.send(JSON.stringify({
              type: 'message',
              data: msg,
              timestamp: msg.timestamp
            }));
          });
          
          // Create join message
          const joinMessage = {
            id: uuidv4(),
            content: `${user.username} joined the chat`,
            timestamp: Date.now(),
            userId: 'system',
            username: 'System',
            type: 'system'
          };
          
          messages.push(joinMessage);
          
          // Broadcast user joined to all clients
          broadcast({
            type: 'user_joined',
            data: {
              user,
              message: joinMessage
            },
            timestamp: Date.now()
          }, ws);
          
          break;
          
        case 'message':
          const currentUser = users.get(ws);
          if (!currentUser) return;
          
          const chatMessage = {
            id: uuidv4(),
            content: message.data.content,
            timestamp: Date.now(),
            userId: currentUser.id,
            username: currentUser.username,
            type: 'message'
          };
          
          messages.push(chatMessage);
          
          // Broadcast message to all clients
          broadcast({
            type: 'message',
            data: chatMessage,
            timestamp: Date.now()
          });
          
          break;
          
        case 'typing_start':
          const typingUser = users.get(ws);
          if (!typingUser) return;
          
          typingUsers.add(typingUser.id);
          
          broadcast({
            type: 'typing_start',
            data: { userId: typingUser.id },
            timestamp: Date.now()
          }, ws);
          
          break;
          
        case 'typing_stop':
          const stoppedTypingUser = users.get(ws);
          if (!stoppedTypingUser) return;
          
          typingUsers.delete(stoppedTypingUser.id);
          
          broadcast({
            type: 'typing_stop',
            data: { userId: stoppedTypingUser.id },
            timestamp: Date.now()
          }, ws);
          
          break;
      }
    } catch (error) {
      console.error('Error processing message:', error);
    }
  });
  
  ws.on('close', () => {
    const user = users.get(ws);
    clearInterval(pingInterval);
    
    if (user) {
      console.log(`User ${user.username} disconnected`);
      
      // Remove from typing users
      typingUsers.delete(user.id);
      
      // Create leave message
      const leaveMessage = {
        id: uuidv4(),
        content: `${user.username} left the chat`,
        timestamp: Date.now(),
        userId: 'system',
        username: 'System',
        type: 'system'
      };
      
      messages.push(leaveMessage);
      
      // Broadcast user left to all remaining clients
      broadcast({
        type: 'user_left',
        data: {
          userId: user.id,
          message: leaveMessage
        },
        timestamp: Date.now()
      });
      
      users.delete(ws);
    }
    
    console.log('Client disconnected');
  });
  
  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
    clearInterval(pingInterval);
  });
});

// Clean up old messages (keep only last 1000)
setInterval(() => {
  if (messages.length > 1000) {
    messages.splice(0, messages.length - 1000);
  }
}, 60000); // Every minute

// Clean up inactive typing indicators
setInterval(() => {
  typingUsers.clear();
}, 10000); // Every 10 seconds