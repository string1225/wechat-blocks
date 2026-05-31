import type { GameUi, ResultState, UiHandlers, UiState } from "./GameUi";

export class NoopHud implements GameUi {
  bind(_handlers: UiHandlers): void {}
  hideResult(): void {}
  showResult(_result: ResultState): void {}
  showToast(_message: string): void {}
  update(_state: UiState): void {}
}
