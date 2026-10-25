const view = ScreenView.create(document.getElementById('screen'), { audio: true });
window.api.onShow((state) => view.update(state));
