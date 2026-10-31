# Keep playback choices through a Shorts session

Fisher found repeated sound prompts and controls covering the video disruptive.
Sound, CC and Player controls now sit under the video. A new session starts muted
with YouTube captions on; choices persist through clips, reloads and Library visits
for the active account/session in this tab. Browser-muted fallback no longer erases
an explicit Sound on preference.

Shorts use one stable iframe across the reel, positioned over the shared card's
measured slot. This retains the browser's sound permission and avoids rebuilding
YouTube for each clip. Loading the next poster ahead removes its image-fetch delay;
this does not claim to buffer video bytes. YouTube's documented cue operation only
prepares the player/thumbnail until playback begins.

YouTube exposes mute/unmute and caption default-on through the documented API.
Live caption toggles use feature-detected loadModule/unloadModule calls, verified
against real embeds in Chromium and WebKit. These methods are not guaranteed by
the public API reference. Player settings retains native controls as a fallback.
Captions on explicitly reloads caption data so the current cue appears promptly;
text burned into the original video remains visible regardless of CC preference.

Automatic playback stays separate from explicit opens. Inactive, hidden and covered
players pause; delayed events from an old video cannot mark the new clip playing
or failed. Normal article and long-video cards retain their existing behavior,
with player settings also moved outside their video frame.

Reading-time writes now use fetch keepalive. WebKit cancelled the read POST fired
while the page unloaded (reload, pagehide), dropping that interval.

Sources: [IFrame API](https://developers.google.com/youtube/iframe_api_reference),
[player parameters](https://developers.google.com/youtube/player_parameters).

Issue: #178.
