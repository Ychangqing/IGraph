import DefaultTheme from 'vitepress/theme'
import HomeCustom from './components/HomeCustom.vue'
import './style.css'

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('HomeCustom', HomeCustom)
  },
}
