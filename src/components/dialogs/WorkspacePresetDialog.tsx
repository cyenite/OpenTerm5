import { Component } from 'react';
import { closeDialog, saveProfile, saveTemplate } from '../../lib/workspace';
import { Dialog } from './Dialog';

interface WorkspacePresetProps {
  chartId?: string;
}

interface WorkspacePresetState {
  name: string;
  error: string;
}

export class WorkspacePresetDialog extends Component<WorkspacePresetProps, WorkspacePresetState> {
  state: WorkspacePresetState = { name: '', error: '' };

  private save = (): void => {
    try {
      if (this.props.chartId) saveTemplate(this.props.chartId, this.state.name);
      else saveProfile(this.state.name);
      closeDialog();
    } catch (error) {
      this.setState({ error: error instanceof Error ? error.message : 'Cannot save these settings.' });
    }
  };

  render() {
    const isTemplate = !!this.props.chartId;
    return (
      <Dialog title={isTemplate ? 'Save Chart Template' : 'Save Profile'}>
        <form onSubmit={(event) => { event.preventDefault(); this.save(); }}>
          <p className="is-muted">{isTemplate ? 'Save chart appearance, indicators and drawings. Applying a template keeps the destination symbol and timeframe.' : 'Save the open charts, indicators, drawings and layout. Changes to the active profile are saved automatically.'}</p>
          <label className="form-row">
            <span>Name</span>
            <input autoFocus maxLength={64} value={this.state.name} onChange={(event) => this.setState({ name: event.target.value, error: '' })} />
          </label>
          <p className="is-muted">An existing name replaces that saved preset.</p>
          {this.state.error && <p role="alert" className="is-loss">{this.state.error}</p>}
          <div className="dialog-actions">
            <button type="button" onClick={closeDialog}>Cancel</button>
            <button type="submit" className="is-primary" disabled={!this.state.name.trim()}>Save {isTemplate ? 'template' : 'profile'}</button>
          </div>
        </form>
      </Dialog>
    );
  }
}
