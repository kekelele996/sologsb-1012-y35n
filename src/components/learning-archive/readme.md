# learning-archive



<!-- Auto Generated Below -->


## Properties

| Property      | Attribute | Description                          | Type              | Default |
| ------------- | --------- | ------------------------------------ | ----------------- | ------- |
| `checkpoints` | --        | 编排台检查点目录（只读），由 app-root 注入，档案不反向改课程。 | `CheckpointRef[]` | `[]`    |
| `online`      | `online`  |                                      | `boolean`         | `true`  |


## Dependencies

### Used by

 - [app-root](../app-root)

### Depends on

- ion-button
- ion-toast

### Graph
```mermaid
graph TD;
  learning-archive --> ion-button
  learning-archive --> ion-toast
  ion-button --> ion-ripple-effect
  ion-toast --> ion-icon
  ion-toast --> ion-ripple-effect
  app-root --> learning-archive
  style learning-archive fill:#f9f,stroke:#333,stroke-width:4px
```

----------------------------------------------

*Built with [StencilJS](https://stenciljs.com/)*
