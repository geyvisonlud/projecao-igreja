const view = StageView.create(document.getElementById('stage'));
window.api.onShow((state) => view.update(state));
