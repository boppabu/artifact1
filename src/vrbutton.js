// vrbutton.js — a minimal local stand-in for three/addons/webxr/VRButton.js,
// so there is no three/addons dependency. Same surface: VRButton.createButton().
export const VRButton = {
  createButton(renderer, sessionInit = {}) {
    const button = document.createElement('button');
    Object.assign(button.style, {
      position: 'absolute', bottom: '20px', left: '50%', transform: 'translateX(-50%)',
      padding: '12px 20px', zIndex: '30', border: '1px solid #4a6', borderRadius: '8px',
      background: 'rgba(10,20,16,0.85)', color: '#d7f4e3',
      font: '14px ui-monospace, monospace', cursor: 'pointer',
    });

    let currentSession = null;

    async function onSessionStarted(session) {
      session.addEventListener('end', onSessionEnded);
      await renderer.xr.setSession(session);
      button.textContent = 'EXIT VR';
      currentSession = session;
    }
    function onSessionEnded() {
      currentSession.removeEventListener('end', onSessionEnded);
      button.textContent = 'ENTER VR';
      currentSession = null;
    }

    if (!navigator.xr) {
      button.textContent = 'WEBXR NOT AVAILABLE';
      button.disabled = true;
      return button;
    }

    button.textContent = 'CHECKING VR…';
    navigator.xr.isSessionSupported('immersive-vr').then((supported) => {
      if (!supported) {
        button.textContent = 'VR NOT SUPPORTED (desktop view)';
        button.disabled = true;
        return;
      }
      button.textContent = 'ENTER VR';
      // local-floor so you stand on the ground; the rest are nice-to-haves.
      const opts = Object.assign(
        { optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking', 'layers'] },
        sessionInit);
      button.onclick = () => {
        if (currentSession === null) {
          navigator.xr.requestSession('immersive-vr', opts).then(onSessionStarted);
        } else {
          currentSession.end();
        }
      };
    });

    return button;
  },
};
