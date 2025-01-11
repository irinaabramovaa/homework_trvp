document.addEventListener('DOMContentLoaded', () => {
    const app = new App();
    app.init();
});



class App {
    #orders = [];

    async init() {
        await this.loadOrders();
        await this.loadCurrentDate();
    
        document.getElementById('add-tasklist-btn')
            .addEventListener('click', this.showOrderForm);
    
        document.addEventListener('keydown', this.onKeydownEscape);
        document.getElementById('add-order-form')
            .addEventListener('submit', this.onSubmitOrderForm.bind(this));
        
        document.getElementById('next-day-btn')
            .addEventListener('click', () => this.advanceDate());


    }
    
    // Загружаем текущую дату
    async loadCurrentDate() {
        try {
            const response = await fetch('/api/v1/date');
            const data = await response.json();
            
            console.log('Дата с сервера:', data.cur_date);  // Логируем дату из API
    
            const formattedDate = new Date(data.cur_date).toISOString().split('T')[0];
            document.getElementById('current-date').value = formattedDate;
    
        } catch (err) {
            console.error('Ошибка загрузки текущей даты:', err);
            alert('Не удалось загрузить дату.');
        }
    }
    
    
    async advanceDate() {
        const dateInput = document.getElementById('current-date');
        let dateText = dateInput.value.trim();
    
        const dateParts = dateText.split('.');
        if (dateParts.length === 3) {
            dateText = `${dateParts[2]}-${dateParts[1]}-${dateParts[0]}`;
        }
    
        const currentDate = new Date(dateText);
    
        if (isNaN(currentDate)) {
            alert('Ошибка: текущая дата некорректна.');
            return;
        }
    
        const nextDate = new Date(currentDate);
        nextDate.setDate(currentDate.getDate() + 1);
        const formattedDate = nextDate.toISOString().split('T')[0];

        dateInput.value = formattedDate;
    
        try {
            const response = await fetch('/api/v1/date/next', {
                method: 'PATCH'
            });
    
            if (response.ok) {
                // Получаем список актуальных заказов
                const updatedOrdersResponse = await fetch('/api/v1/orders');
                const updatedOrdersData = await updatedOrdersResponse.json();
    
                if (updatedOrdersResponse.ok) {
                    this.#orders = updatedOrdersData.orders;
    
                    // Йееей рендерим список заказов
                    this.renderOrders();
    
                    //alert('Дата обновлена, просроченные заказы удалены.');
                }
            } else {
                throw new Error('Ошибка на сервере');
            }
        } catch (err) {
            console.error('Ошибка при обновлении даты:', err);
            alert('Произошла ошибка при обновлении даты.');
        }
    }
    
    // Рендеринг заказов после обновления
    renderOrders() {
        const orderList = document.querySelector('.tasklists-list');
        orderList.innerHTML = '';  // Очищаем старый список
    
        for (const order of this.#orders) {
            this.addOrder({
                orderId: order.order_id,
                customer: order.customer_name || 'Не указано',
                date: order.order_date || 'Не указано'
            });
            this.loadOrderItems(order.order_id);
        }
    }
    
    // Загрузка заказов с сервера
    async loadOrders() {
        try {
            const response = await fetch('/api/v1/orders');
            const data = await response.json();
        
            if (response.ok && data.orders.length > 0) {
                // Добавляем заказы
                for (const order of data.orders) {
                    await this.addOrder({
                        orderId: order.order_id,
                        customer: order.customer_name || 'Не указано',
                        date: order.order_date || 'Не указано'
                    });
                    await this.loadOrderItems(order.order_id);
                }
                
            } else {
                console.warn('Нет доступных заказов.');
            }
        } catch (err) {
            console.error('Ошибка загрузки данных:', err);
            alert('Ошибка загрузки заказов.');
        }
    }

    // Редактирование товара 
    onEditOrderItem = async ({ item_id, order_id }) => {
        const newQuantity = prompt('Введите новое количество:');
        if (!newQuantity || isNaN(newQuantity) || newQuantity <= 0) return;

        const response = await fetch(`/api/v1/orders/${order_id}/items/${item_id}`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ quantity: newQuantity })
        });

        if (response.ok) {
            const itemElement = document.querySelector(`li[id="${item_id}"] > span.task__name`);
            const productName = itemElement.textContent.split('-')[0].trim();  // Нам надо наименование ааааааааааааааа
            itemElement.innerHTML = `${productName} - ${newQuantity} шт.`;
            alert('Количество обновлено!');
        }
         else {
            const data = await response.json();
            alert('Ошибка: ' + data.message);
        }
    };

// Удаление товара из заказа
    async onDeleteOrderItem({ item_id, order_id }) {
        const confirmDelete = confirm('Удалить этот товар из заказа?');
        if (!confirmDelete) return;

        const response = await fetch(`/api/v1/orders/${order_id}/items/${item_id}`, {
            method: 'DELETE'
        });

        if (response.ok) {
            document.querySelector(`li[id="${item_id}"]`)?.remove();
            alert('Товар удален.');
        } else {
            alert('Ошибка при удалении товара.');
        }
    }


// Перемещение товара между заказами
onMoveOrderItem = async ({ item_id, order_id, direction }) => {
    console.log('Клик по перемещению товара:', { item_id, order_id, direction });

    const orders = Array.from(document.querySelectorAll('.tasklist'));
    const currentIndex = orders.findIndex(order => order.id === order_id);

    let targetOrderId = null;

    if (direction === TaskBtnTypes.MOVE_TASK_BACK && currentIndex > 0) {
        targetOrderId = orders[currentIndex - 1].id;  
    } 
    else if (direction === TaskBtnTypes.MOVE_TASK_FORWARD && currentIndex < orders.length - 1) {
        targetOrderId = orders[currentIndex + 1].id;  
    }

    if (!targetOrderId) {
        alert('Невозможно переместить товар.');
        return;
    }

    // Запрос на сервер
    const response = await fetch(`/api/v1/orders/${order_id}/items/${item_id}/move`, {
        method: 'PATCH',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ target_order_id: targetOrderId })
    });

    if (response.ok) {
        const movedItemEl = document.querySelector(`li[id="${item_id}"]`);
        movedItemEl?.remove();

        // Рендеринг товарчика в новом заказе
        const data = await response.json();
        this.addItemToOrder(targetOrderId, {
            item_id: item_id,
            product_name: data.product_name,
            quantity: data.quantity
        });

        alert('Товар перемещен!');
    } else {
        const errorData = await response.json();
        alert('Ошибка при перемещении: ' + errorData.message);
    }
}

    
    async loadOrderItems(orderId) {
        try {
            const response = await fetch(`/api/v1/orders/${orderId}/items`);
            const data = await response.json();
    
            console.log('Items:', data);  // Лог для проверки данных
    
            if (response.ok && data.items.length > 0) {
                data.items.forEach(item => {
                    const orderItem = new OrderItem({
                        item_id: item.item_id,
                        product_name: item.product_name || 'Неизвестный товар',
                        quantity: item.quantity,
                        order_id: orderId,
                        onEditItem: this.onEditOrderItem.bind(this),  
                        onDeleteItem: this.onDeleteOrderItem.bind(this),  
                        onMoveItem: this.onMoveOrderItem.bind(this)
                    });
    
                    orderItem.render();
                });
            }
        } catch (err) {
            console.error(`Ошибка загрузки позиций заказа ${orderId}:`, err);
        }
    }
    
    
    showOrderForm() {
        const form = document.getElementById('add-order-form');
        form.style.display = form.style.display === 'none' ? 'block' : 'none';
        if (form.style.display === 'block') {
            form.querySelector('#order-customer').focus();
        }
    }

    onKeydownEscape(event) {
        if (event.key === 'Escape') {
            const form = document.getElementById('add-order-form');
            form.style.display = 'none';
            form.reset();
        }
    }

    async onSubmitOrderForm(event) {
        event.preventDefault();
        const customer = document.getElementById('order-customer').value;
        const date = document.getElementById('order-date').value;
        const orderId = crypto.randomUUID();
    
        const newOrder = { orderId, customer, date };
    
        const response = await fetch('/api/v1/orders', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
           
            },
            body: JSON.stringify(newOrder)
        });

        const data = await response.json();
        if (data.success) {
            this.addOrder(newOrder);
            alert('Заказ добавлен!');
        } else {
            alert('Ошибка: ' + data.message);
        }

        const form = document.getElementById('add-order-form');
        form.style.display = 'none';
        form.reset();
    }

// Рендерим сам заказ на странице
addOrder({ orderId, customer, date }) {
    return new Promise((resolve) => {
        const orderList = document.querySelector('.tasklists-list');
        const formattedDate = this.formatDate(date);

        const orderEl = document.createElement('li');
        orderEl.classList.add('tasklist');
        orderEl.setAttribute('id', orderId);

        orderEl.innerHTML = `
            <header class="tasklist__header">
                Заказ
                <button class="order-delete-btn">
                    <img src="./assets/delete-button.svg" alt="Удалить заказ">
                </button>
            </header>
            <div class="order-info">
                <div class="order-customer">ФИО: ${customer}</div>
                <div class="order-id">ID: ${orderId}</div>
                <div class="order-date">Дата: ${formattedDate}</div>
            </div>
            <ul class="tasklist__tasks-list"></ul>
            <button class="tasklist__add-task-btn">Добавить товар</button>
        `;

        // Обработчик для удаления заказа
        orderEl.querySelector('.order-delete-btn')
            .addEventListener('click', () => this.onDeleteOrder(orderId));

        orderEl.querySelector('.tasklist__add-task-btn')
            .addEventListener('click', () => this.showAddItemForm(orderId));

        orderList.insertBefore(orderEl, orderList.lastElementChild);

        resolve();
    });
}

// Удаление заказа
async onDeleteOrder(orderId) {
    const confirmDelete = confirm('Вы уверены, что хотите удалить этот заказ?');
    if (!confirmDelete) return;

    const response = await fetch(`/api/v1/orders/${orderId}`, {
        method: 'DELETE'
    });

    if (response.ok) {
        // Удаляем заказ из массива #orders
        this.#orders = this.#orders.filter(order => order.orderId !== orderId);

        // Удаляем элемент из DOM
        document.querySelector(`li[id="${orderId}"]`)?.remove();

        alert('Заказ удален.');
    } else {
        const data = await response.json();
        alert('Ошибка при удалении заказа: ' + data.message);
    }
}

    // Форма для добавления заказа 
    async showAddItemForm(orderId) {
        let products = [];
        try {
            const response = await fetch('/api/v1/products');
            const data = await response.json();
            products = data.products;
        } catch (err) {
            console.error('Ошибка загрузки товаров:', err);
            alert('Ошибка загрузки товаров.');
            return;
        }
    
        const productOptions = products.map(
            product => `<option value="${product.product_id}">${product.product_name}</option>`
        ).join('');
    
        const formHtml = `
            <form class="add-item-form">
                <label>Товар:</label>
                <select required>${productOptions}</select>
                <label>Количество:</label>
                <input type="number" min="1" required>
                <button type="submit">Добавить</button>
            </form>
        `;
    
        const tasklistEl = Array.from(document.querySelectorAll('.tasklist'))
            .find(el => el.querySelector('.order-id')?.textContent.includes(orderId));
    
        if (tasklistEl) {
            tasklistEl.insertAdjacentHTML('beforeend', formHtml);
            const form = tasklistEl.querySelector('.add-item-form');
            form.addEventListener('submit', (event) => this.submitItemForm(event, orderId));
        }
    }
    
    // Добавление товара в заказ
    async submitItemForm(event, orderId) {
        event.preventDefault();
        const form = event.target;
        const select = form.querySelector('select');
        const product_id = select.value;
        const product_name = select.options[select.selectedIndex].text;
        const quantity = form.querySelector('input[type="number"]').value;
    
        const newItem = { order_id: orderId, product_id, quantity };
    
        const response = await fetch(`/api/v1/orders/${orderId}/items`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(newItem)
        });
    
        const data = await response.json();
    
        if (response.ok) {
            this.addItemToOrder(orderId, {
                item_id: data.item_id,
                product_name,
                quantity
            });
            alert('Товар добавлен!');
        } else {
            alert('Ошибка: ' + data.message);
        }
    
        form.remove();
    }
    
    async onEditOrderItem({ item_id, order_id }) {
        const newQuantity = prompt('Введите новое количество:');
        if (!newQuantity || isNaN(newQuantity) || newQuantity <= 0) return;
    
        const response = await fetch(`/api/v1/orders/${order_id}/items/${item_id}`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ quantity: newQuantity })
        });
    
        const data = await response.json();
    
        if (response.ok) {
            const itemElement = document.querySelector(`li[id="${item_id}"] > span.task__name`);
            const productName = itemElement.textContent.split('-')[0].trim();
            itemElement.innerHTML = `${productName} - ${newQuantity} шт.`;
            alert('Количество обновлено!');
        } else {
            alert('Ошибка: ' + data.message);
        }
    }
    
    
    // Рендерим товар внутри заказа
    addItemToOrder(orderId, { item_id, product_name, quantity }) {
        const orderEl = Array.from(document.querySelectorAll('.tasklist'))
            .find(el => el.querySelector('.order-id')?.textContent.includes(orderId));
    
        if (orderEl) {
            const taskList = orderEl.querySelector('.tasklist__tasks-list');
            const itemEl = document.createElement('li');
            itemEl.setAttribute('id', item_id);
            itemEl.classList.add('task');  // Добавляем класс task для оформления
    
            itemEl.innerHTML = `
                <span class="task__name">${product_name || 'Товар не найден'} - ${quantity} шт.</span>
                <div class="task__controls">
                    <button class="task-edit">
                        <img src="./assets/edit.svg" alt="Edit">
                    </button>
                    <button class="task-delete">
                        <img src="./assets/delete-button.svg" alt="Delete">
                    </button>
                    <button class="task-move-back">
                        <img src="./assets/left-arrow.svg" alt="Move Back">
                    </button>
                    <button class="task-move-forward">
                        <img src="./assets/right-arrow.svg" alt="Move Forward">
                    </button>
                </div>
            `;
    
            // Добавляем обработчики на кнопки
            itemEl.querySelector('.task-edit').addEventListener('click', () => {
                this.onEditOrderItem({ item_id, order_id: orderId });
            });
    
            itemEl.querySelector('.task-delete').addEventListener('click', () => {
                this.onDeleteOrderItem({ item_id, order_id: orderId });
            });
    
            itemEl.querySelector('.task-move-back').addEventListener('click', () => {
                this.onMoveOrderItem({
                    item_id,
                    order_id: orderId,
                    direction: TaskBtnTypes.MOVE_TASK_BACK
                });
            });
    
            itemEl.querySelector('.task-move-forward').addEventListener('click', () => {
                this.onMoveOrderItem({
                    item_id,
                    order_id: orderId,
                    direction: TaskBtnTypes.MOVE_TASK_FORWARD
                });
            });
    
            taskList.appendChild(itemEl);
        } else {
            console.error('Не удалось добавить товар к заказу с ID:', orderId);
        }
    }
    
    formatDate(dateString) {
        if (!dateString) return 'Дата не указана';
        
        const date = new Date(dateString);
        if (isNaN(date)) return 'Дата некорректна';
    
        const day = date.getDate().toString().padStart(2, '0');
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const year = date.getFullYear();
    
        return `${day}.${month}.${year}`;
    }
}



class OrderItem {
    #item_id = '';
    #product_name = '';
    #quantity = 0;
    #order_id = '';

    constructor({ item_id, product_name, quantity, order_id, onEditItem, onDeleteItem, onMoveItem }) {
        this.#item_id = item_id;
        this.#product_name = product_name;
        this.#quantity = quantity;
        this.#order_id = order_id;
        this.onEditItem = onEditItem;
        this.onDeleteItem = onDeleteItem;
        this.onMoveItem = onMoveItem;
    }

    get item_id() {
        return this.#item_id;
    }

    render() {
        console.log('Рендеринг товара:', {
            item_id: this.#item_id,
            product_name: this.#product_name,
            order_id: this.#order_id
        });
    
        const orderEl = document.querySelector(`li[id="${this.#order_id}"] > ul.tasklist__tasks-list`);
        
        if (!orderEl) {
            console.error(`Контейнер для заказа ${this.#order_id} не найден.`);
            return;  // Прерываем выполнение, если контейнер не найден
        }
    
        const itemEl = document.createElement('li');
        itemEl.classList.add('task');
        itemEl.setAttribute('id', this.#item_id);
    
        const spanEl = document.createElement('span');
        spanEl.classList.add('task__name');
        spanEl.innerHTML = `${this.#product_name} - ${this.#quantity} шт.`;
        itemEl.appendChild(spanEl);
    
        const controlsEl = document.createElement('div');
        controlsEl.classList.add('task__controls');
    
        TaskBtnParams.forEach(({ className, imgSrc, imgAlt, type }) => {
            const buttonEl = document.createElement('button');
            buttonEl.classList.add(className);
    
            switch (type) {
                case TaskBtnTypes.EDIT_TASK:
                    buttonEl.addEventListener('click', () => this.onEditItem({
                        item_id: this.#item_id,
                        order_id: this.#order_id
                    }));
                    break;
                case TaskBtnTypes.DELETE_TASK:
                    buttonEl.addEventListener('click', () => this.onDeleteItem({
                        item_id: this.#item_id,
                        order_id: this.#order_id
                    }));
                    break;
                case TaskBtnTypes.MOVE_TASK_BACK:
                case TaskBtnTypes.MOVE_TASK_FORWARD:
                    buttonEl.addEventListener('click', () => {
                        console.log('Клик по перемещению товара');
                        this.onMoveItem({
                            item_id: this.#item_id,
                            order_id: this.#order_id,
                            direction: type
                        });
                    });
                    break;
            }
    
            const imgEl = document.createElement('img');
            imgEl.setAttribute('src', imgSrc);
            imgEl.setAttribute('alt', imgAlt);
            buttonEl.appendChild(imgEl);
            controlsEl.appendChild(buttonEl);
        });
    
        itemEl.appendChild(controlsEl);
        orderEl.appendChild(itemEl);
    }
    
    
}

const TaskBtnTypes = {
    EDIT_TASK: 'EDIT_TASK',
    DELETE_TASK: 'DELETE_TASK',
    MOVE_TASK_BACK: 'MOVE_TASK_BACK',
    MOVE_TASK_FORWARD: 'MOVE_TASK_FORWARD'
};

const TaskBtnParams = [
    {
        className: 'task-edit',
        imgSrc: './assets/edit.svg',
        imgAlt: 'Edit task',
        type: TaskBtnTypes.EDIT_TASK
    },
    {
        className: 'task-delete',
        imgSrc: './assets/delete-button.svg',
        imgAlt: 'Delete task',
        type: TaskBtnTypes.DELETE_TASK
    },
    {
        className: 'task-move-back',
        imgSrc: './assets/left-arrow.svg',
        imgAlt: 'Move task back',
        type: TaskBtnTypes.MOVE_TASK_BACK
    },
    {
        className: 'task-move-forward',
        imgSrc: './assets/right-arrow.svg',
        imgAlt: 'Move task forward',
        type: TaskBtnTypes.MOVE_TASK_FORWARD
    }
];

