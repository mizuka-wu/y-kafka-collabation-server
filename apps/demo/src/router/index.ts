import { createRouter, createWebHistory } from 'vue-router';
import Home from '../pages/Home.vue';
import ProsemirrorDemo from '../pages/ProsemirrorDemo.vue';
import StressTestDemo from '../pages/StressTestDemo.vue';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      name: 'home',
      component: Home,
    },
    {
      path: '/prosemirror',
      name: 'prosemirror',
      component: ProsemirrorDemo,
    },
    {
      path: '/stress',
      name: 'stress',
      component: StressTestDemo,
    },
  ],
});

export default router;
