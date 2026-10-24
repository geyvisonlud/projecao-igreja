const view = ScreenView.create(document.getElementById('screen'));
window.api.onShow((state) => view.update(state));
