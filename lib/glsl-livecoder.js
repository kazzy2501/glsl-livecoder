/* @flow */
import GlslLivecoderView from './glsl-livecoder-view';
import validator from './validator';
import ThreeShader from './three-shader';
import Config from './config';

const DEFAULT_SHADER = `
precision mediump float;
uniform float time;
uniform vec2 mouse;
uniform vec2 resolution;

void main() {
  vec2 uv = gl_FragCoord.xy / resolution.xy;
  gl_FragColor = vec4(uv,0.5+0.5*sin(time),1.0);
}
`;

declare var atom: any;
type TextEditor = any;
type GlslLivecoderState = {
  isPlaying: boolean;
  activeEditorDisposer?: any;
  editorDisposer?: any;
  editor?: TextEditor;
};

export default class GlslLivecoder {
  _view: GlslLivecoderView;
  _three: ThreeShader;
  _state: GlslLivecoderState;
  _glslangValidatorPath: string;
  _lastShader: { shader: string, postfix: string };

  _config: Config;

  constructor(config: Config) {
    this._view = new GlslLivecoderView();
    atom.workspace.element.appendChild(this._view.getElement());

    this._config = config;
    this._config.on('change', ({ newConfig, added, removed }) => {
      // Get paths for videos still in use
      const importedPaths = {};
      Object.values(newConfig.IMPORTED).forEach(imported => {
        importedPaths[(imported: any).PATH] = true;
      });

      Object.keys(removed.IMPORTED).forEach(key => {
        const path = removed.IMPORTED[key].PATH;
        this._three.unloadTexture(key, path, !importedPaths[path]);
      });
      Object.keys(added.IMPORTED).forEach(key => {
        this._three.loadTexture(key, added.IMPORTED[key].PATH);
      });
      if (added.vertexMode) {
        this._three.setVertexMode(added.vertexMode);
      }
      if (added.vertexCount) {
        this._three.setVertexCount(added.vertexCount);
      }
      if (added.pixelRatio) {
        this._three.setPixelRatio(added.pixelRatio);
      }
      if (added.frameskip) {
        this._three.setFrameskip(added.frameskip);
      }
      if (added.glslangValidatorPath) {
        this._glslangValidatorPath = added.glslangValidatorPath;
      }
      if (added.audio !== undefined) {
        this._three.toggleAudio(added.audio);
      }
      if (added.midi !== undefined) {
        this._three.toggleMidi(added.midi);
      }
      if (added.keyboard !== undefined) {
        this._three.toggleKeyboard(added.keyboard);
      }
      if (added.gamepad !== undefined) {
        this._three.toggleGamepad(added.gamepad);
      }
      if (added.camera !== undefined) {
        this._three.toggleCamera(added.camera);
      }

      this.loadLastShader();
    });

    const rc = this._config.rc;
    this._three = new ThreeShader(rc.pixelRatio, rc.frameskip);
    this._three.setCanvas(this._view.getCanvas());

    this._state = {
      isPlaying: false,
    };
  }

  destroy(): void {
    this._three.stop();
    this._view.destroy();
  }

  setValidatorPath(path: string): void {
    this._glslangValidatorPath = path;
  }

  setPixelRatio(x: number): void {
    this._three.setPixelRatio(x);
  }

  setFrameskip(x: number): void {
    this._three.setFrameskip(x);
  }

  setVertexCount(x: number): void {
    this._three.setVertexCount(x);
  }

  setVertexMode(x: string): void {
    this._three.setVertexMode(x);
  }

  toggle(): void {
    return (
      this._state.isPlaying ?
        this.stop() :
        this.play()
    );
  }

  play(): void {
    this._view.show();
    this._three.loadShader(DEFAULT_SHADER);
    this._three.play();
    this._state.isPlaying = true;
  }

  stop(): void {
    this._view.hide();
    this._three.stop();
    this._state.isPlaying = false;
    this.stopWatching();
  }

  watchActiveShader(): void {
    if (this._state.activeEditorDisposer) {
      return;
    }

    this.watchShader();
    this._state.activeEditorDisposer = atom.workspace.onDidChangeActiveTextEditor(() => {
      this.watchShader();
    });
  }

  watchShader(): void {
    if (this._state.editorDisposer) {
      this._state.editorDisposer.dispose();
      this._state.editorDisposer = null;
    }

    const editor = atom.workspace.getActiveTextEditor();
    this._state.editor = editor;
    this.loadShaderOfEditor(editor);

    if (editor !== undefined) {
      this._state.editorDisposer = editor.onDidStopChanging(() => {
        this.loadShaderOfEditor(editor);
      });
    }
  }

  loadShader(): void {
    const editor = atom.workspace.getActiveTextEditor();
    this.loadShaderOfEditor(editor);
  }

  loadLastShader(): void {
    if (!this._lastShader) {
      return;
    }

    const { shader, postfix } = this._lastShader;
    if (postfix === '.frag' || postfix === '.glsl') {
      this._three.loadShader(shader);
    } else {
      this._three.loadVertexShader(shader);
    }
  }

  stopWatching(): void {
    this._state.editor = null;
    if (this._state.activeEditorDisposer) {
      this._state.activeEditorDisposer.dispose();
      this._state.activeEditorDisposer = null;
    }
    if (this._state.editorDisposer) {
      this._state.editorDisposer.dispose();
      this._state.editorDisposer = null;
    }
  }

  /**
  * @private
  */
  loadShaderOfEditor(editor: TextEditor): void {
    if (editor === undefined) {
      // This case occurs when no files are open/active
      return;
    }
    const path = editor.getPath();
    const m = (path || '').match(/(\.(?:glsl|frag|vert))$/);
    if (!m) {
      console.error('The filename for current doesn\'t seems to be GLSL.');
      return;
    }

    const postfix = m[1];
    const shader = editor.getText();
    validator(this._glslangValidatorPath, shader, postfix)
      .then(() => {
        const headComment = (shader.match(/(?:\/\*)((?:.|\n|\r|\n\r)*)(?:\*\/)/) || [])[1];
        this._config.setCommentByString(path, headComment);
      })
      .then(() => {
        this._lastShader = { shader, postfix };
        if (postfix === '.frag' || postfix === '.fs') {
          this._three.loadShader(shader);
        } else if (postfix === '.vert' || postfix === '.vs') {
          this._three.loadVertexShader(shader);
        } else {
          this._three.loadShader(shader);
        }
      })
      .catch(e => {
        console.error(e);
      });
  }
}
