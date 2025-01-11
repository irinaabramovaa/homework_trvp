import dotenv from 'dotenv';
import express from 'express';
import DBAdapter, { DB_ERROR_TYPE_CLIENT } from './adapters/DBAdapter.js';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config({
    path: '.env'
});

const {
    TM_APP_HOST,
    TM_APP_PORT,
    TM_DB_HOST,
    TM_DB_PORT,
    TM_DB_NAME,
    TM_DB_USER_LOGIN,
    TM_DB_USER_PASSWORD
} = process.env;

const serverApp = express();
const dbAdapter = new DBAdapter({
    dbHost: TM_DB_HOST,
    dbPort: TM_DB_PORT,
    dbName: TM_DB_NAME,
    dbUserLogin: TM_DB_USER_LOGIN,
    dbUserPassword: TM_DB_USER_PASSWORD
});

// === Добавляем поддержку ES-модулей и статических файлов ===
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

serverApp.use(express.static(path.join(__dirname, '../client')));

serverApp.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/index.html'));
});
// ==========================================================

// middleware - логирование запросов
serverApp.use('*', (req, res, next) => {
    console.log(
        new Date().toISOString(),
        req.method,
        req.originalUrl 
    );

    next();
});

// middlewares - json parse
serverApp.use('/api/v1/tasklists', express.json());
serverApp.use('/api/v1/tasks', express.json());
serverApp.use('/api/v1/tasks/:taskID', express.json());
//////////////////////////////////////////////////////////////////////////////////////////////////////////////

// middlewares - json parse
serverApp.use(express.json());

serverApp.use('/api/v1/orders', express.json());
serverApp.use('/api/v1/orders/:order_id/items', express.json());
serverApp.use('/api/v1/orders/:order_id', express.json());

serverApp.get('/api/v1/products', async (req, res) => {
    try {
        const products = await dbAdapter.getProducts();
        res.status(200).json({ products });
    } catch (err) {
        res.status(500).json({
            message: 'Error fetching products',
            error: err.message
        });
    }
});



serverApp.get('/api/v1/orders', async (req, res) => {
    try {
        const orders = await dbAdapter.getOrders();
        res.status(200).json({ orders });
    } catch (err) {
        res.status(500).json({
            message: 'Error fetching orders',
            error: err.message
        });
    }
});

serverApp.get('/api/v1/orders/:order_id/items', async (req, res) => {
    const { order_id } = req.params;
    try {
        const items = await dbAdapter.getOrderItemsWithNames(order_id);
        res.status(200).json({ items });
    } catch (err) {
        res.status(500).json({
            message: 'Error fetching order items',
            error: err.message
        });
    }
});



serverApp.post('/api/v1/orders', async (req, res) => {
    const { orderId, customer, date } = req.body;

    if (!customer || !date) {
        return res.status(400).json({ success: false, message: 'ФИО и дата обязательны' });
    }

    try {
        const currentDate = await dbAdapter.getCurrentDate();
        if (new Date(date) < new Date(currentDate)) {
            return res.status(400).json({
                success: false,
                message: 'Дата заказа не может быть меньше текущей даты'
            });
        }

        await dbAdapter.addOrder({ orderId, customer, date });
        res.json({ success: true });
    } catch (err) {
        console.error('Ошибка добавления в БД:', err);
        res.status(500).json({ success: false, message: 'Ошибка при добавлении заказа' });
    }
});




serverApp.post('/api/v1/orders/:order_id/items', async (req, res) => {
    const { order_id } = req.params;
    const { product_id, quantity } = req.body;
    const item_id = crypto.randomUUID();

    try {
        // Получаем информацию о товаре
        const product = await dbAdapter.getProductById(product_id);

        // Проверяем наличие товара на складе
        if (product.stock < quantity) {
            return res.status(400).json({
                success: false,
                message: `Недостаточно товара. Доступно на складе: ${product.stock} шт.`
            });
        }

        // Если товара хватает, добавляем позицию в заказ
        const result = await dbAdapter.addOrderItem({ item_id, order_id, product_id, quantity });

        res.status(201).json({ item_id: result.item_id });
    } catch (err) {
        console.error('Ошибка добавления товара в заказ:', err);
        res.status(500).json({
            message: 'Ошибка при добавлении товара в заказ',
            error: err.message
        });
    }
});



// Удаление заказа по ID
serverApp.delete('/api/v1/orders/:order_id', async (req, res) => {
    const { order_id } = req.params;
    try {
        await dbAdapter.deleteOrder({ order_id });
        res.status(200).json({ message: 'Заказ успешно удален' });
    } catch (err) {
        res.status(500).json({
            message: 'Ошибка при удалении заказа',
            error: err.message
        });
    }
});


serverApp.patch('/api/v1/orders/:order_id/items/:item_id', async (req, res) => {
    const { item_id } = req.params;
    const { quantity } = req.body;

    try {
        // Получаем информацию о позиции заказа
        const item = await dbAdapter.getOrderItem({ item_id });

        if (!item) {
            return res.status(404).json({ message: 'Товар не найден в заказе' });
        }

        // Проверяем остатки на складе
        const product = await dbAdapter.getProductById(item.product_id);
        const newStock = product.stock + item.quantity;  // Включаем текущее количество в заказе

        if (newStock < quantity) {
            return res.status(400).json({
                message: `Недостаточно товара на складе. Доступно: ${newStock} шт.`
            });
        }

        // Обновляем количество в позиции заказа
        await dbAdapter.updateOrderItem({ item_id, quantity });

        res.status(200).json({ message: 'Количество товара обновлено' });
    } catch (err) {
        console.error('Ошибка обновления товара в заказе:', err);
        res.status(500).json({
            message: 'Ошибка обновления товара в заказе',
            error: err.message
        });
    }
});


serverApp.patch('/api/v1/orders/:order_id/items/:item_id/move', async (req, res) => {
    const { order_id, item_id } = req.params;
    const { target_order_id } = req.body;

    try {
        // Обновляем order_id для товара
        await dbAdapter.moveOrderItem({ item_id, target_order_id });

        // Получаем обновленные данные о товаре
        const updatedItem = await dbAdapter.getOrderItem({ item_id });

        res.status(200).json(updatedItem);
    } catch (err) {
        console.error('Error moving item:', err);
        res.status(500).json({
            message: 'Ошибка при перемещении товара',
            error: err.message
        });
    }
});


serverApp.delete('/api/v1/orders/:order_id/items/:item_id', async (req, res) => {
    const { order_id, item_id } = req.params;

    try {
        // Получаем информацию о товаре в заказе
        const item = await dbAdapter.getOrderItem({ item_id });

        if (!item) {
            return res.status(404).json({
                message: 'Позиция в заказе не найдена'
            });
        }

        // Удаляем позицию из заказа
        await dbAdapter.deleteOrderItem({ order_id, item_id });

        // Возвращаем товар на склад
        await dbAdapter.restockProduct({ product_id: item.product_id, quantity: item.quantity });

        res.status(200).json({
            message: 'Товар удален из заказа и возвращен на склад'
        });
    } catch (err) {
        console.error('Ошибка при удалении товара из заказа:', err);
        res.status(500).json({
            message: 'Ошибка при удалении товара из заказа',
            error: err.message
        });
    }
});


serverApp.get('/api/v1/date', async (req, res) => {
    try {
        const result = await dbAdapter.getCurrentDate();
        
        if (!result) {
            res.status(404).json({ message: 'Дата не найдена' });
            return;
        }
        
        console.log('SQL результат:', result);  
        res.status(200).json({ cur_date: result }); 
    } catch (err) {
        console.error('Ошибка при получении даты:', err);
        res.status(500).json({ message: 'Ошибка получения даты' });
    }
});


serverApp.patch('/api/v1/date/next', async (req, res) => {
    try {
        const updatedDate = await dbAdapter.incrementDate();
        await dbAdapter.deleteExpiredOrders();
        await dbAdapter.restockProducts();

        console.log('Обновленная дата в БД:', updatedDate);

        res.status(200).json({
            message: 'Дата обновлена, заказы отгружены и склад пополнен.',
            cur_date: updatedDate.toISOString().split('T')[0]
        });
    } catch (err) {
        console.error('Ошибка при обновлении даты:', err);
        res.status(500).json({
            message: 'Ошибка при обновлении даты',
            error: err.message || err
        });
    }
});





//////////////////////////////////////////////////////////////////////////////////////////////////////////////
/*
serverApp.get('/api/v1/tasklists', async (req, res) => {
    try {
        const [dbTasklists, dbTasks] = await Promise.all([
            dbAdapter.getTasklists(),
            dbAdapter.getTasks()
        ]);

        const tasks = dbTasks.map(
            ({ id, name, position, tasklist_id }) => ({
                taskID: id,
                taskName: name,
                taskPosition: position,
                tasklistID: tasklist_id //преобразовали задачи из объекта бд-шных в объекты, которые на фронте воспринимаются с парвильным неймингом
            })
        );

        const tasklists = dbTasklists.map(
            ({ id, name, position }) => ({
                tasklistID: id,
                tasklistName: name,
                tasklistPosition: position,
                tasks: tasks.filter(task => task.tasklistID === id)
            })
        );

        res.statusCode = 200;
        res.statusMessage = 'OK';
        res.json({ tasklists });
    } catch (err) {
        res.statusCode = 500;
        res.statusMessage = 'Internal server error';
        res.json({
            timestamp: new Date().toISOString(),
            statusCode: 500,
            message: `get tasklists error: ${err.error.message || err.error}`
        });
    }
});
serverApp.post('/api/v1/tasklists', async (req, res) => {
    try {
        const {
            tasklistName,
            tasklistPosition
        } = req.body;
        const tasklistID = crypto.randomUUID();

        await dbAdapter.addTasklist({
            tasklistID,
            name: tasklistName,
            position: tasklistPosition
        });

        res.statusCode = 200;
        res.statusMessage = 'OK';
        res.json({ tasklistID });
    } catch (err) {
        switch (err.type) {
            case DB_ERROR_TYPE_CLIENT:
                res.statusCode = 400;
                res.statusMessage = 'Bad request';
                break;

            default:
                res.statusCode = 500;
                res.statusMessage = 'Internal server error';
        }

        res.json({
            timestamp: new Date().toISOString(),
            statusCode: res.statusCode,
            message: `add tasklist error: ${err.error.message || err.error}`
        });        
    }
});
serverApp.post('/api/v1/tasks', async (req, res) => {
    try {
        const {
            taskName,
            taskPosition,
            tasklistID
        } = req.body;
        const taskID = crypto.randomUUID();

        await dbAdapter.addTask({
            taskID,
            name: taskName,
            position: taskPosition,
            tasklistID
        });

        res.statusCode = 200;
        res.statusMessage = 'OK';
        res.json({ taskID });
    } catch (err) {
        switch (err.type) {
            case DB_ERROR_TYPE_CLIENT:
                res.statusCode = 400;
                res.statusMessage = 'Bad request';
                break;

            default:
                res.statusCode = 500;
                res.statusMessage = 'Internal server error';
        }

        res.json({
            timestamp: new Date().toISOString(),
            statusCode: res.statusCode,
            message: `add task error: ${err.error.message || err.error}`
        });        
    }
});
serverApp.patch('/api/v1/tasklists/:tasklistID', async (req, res) => {
    try {
        const { tasklistName } = req.body;
        const { tasklistID } = req.params;

        await dbAdapter.updateTasklist({ tasklistID, name: tasklistName });

        res.statusCode = 200;
        res.statusMessage = 'OK';
        res.json({ message: 'Tasklist updated successfully' });
    } catch (err) {
        res.statusCode = 500;
        res.statusMessage = 'Internal server error';
        res.json({
            timestamp: new Date().toISOString(),
            statusCode: 500,
            message: `update tasklist error: ${err.error.message || err.error}`
        });
    }
});
serverApp.patch('/api/v1/tasks/:taskID', async (req, res) => {
    try {
        const { taskName, taskPosition } = req.body;
        const { taskID } = req.params;

        await dbAdapter.updateTask({
            taskID,
            name: taskName,
            position: taskPosition
        });

        res.statusCode = 200;
        res.statusMessage = 'OK';
        
        // --- Добавляем JSON-ответ ---
        res.json({ message: 'Task updated successfully' });

    } catch (err) {
        switch (err.type) {
            case DB_ERROR_TYPE_CLIENT:
                res.statusCode = 400;
                res.statusMessage = 'Bad request';
                break;
            default:
                res.statusCode = 500;
                res.statusMessage = 'Internal server error';
        }
        res.json({
            timestamp: new Date().toISOString(),
            statusCode: res.statusCode,
            message: `update task error: ${err.error.message || err.error}`
        });
    }
});
serverApp.delete('/api/v1/tasklists/:tasklistID', async (req, res) => {
    try {
        const { tasklistID } = req.params;

        // Удаляем задачи, привязанные к тасклисту
        await dbAdapter.deleteTasksByTasklist({ tasklistID });

        // Удаляем сам тасклист
        await dbAdapter.deleteTasklist({ tasklistID });

        res.status(200).json({ message: 'Tasklist deleted successfully' });
    } catch (err) {
        res.status(500).json({
            message: 'Error deleting tasklist',
            error: err.message || err
        });
    }
});
serverApp.delete('/api/v1/tasks/:taskID', async (req, res) => {
    try {
        const { taskID } = req.params;

        await dbAdapter.deleteTask({ taskID });

        res.status(200).json({ message: 'Task deleted successfully' });  // <-- ОТПРАВЛЯЕМ JSON
    } catch (err) {
        switch (err.type) {
            case DB_ERROR_TYPE_CLIENT:
                res.status(400).json({
                    message: 'Bad request',
                    error: err.error.message || err.error
                });
                break;
            default:
                res.status(500).json({
                    message: 'Internal server error',
                    error: err.error.message || err.error
                });
        }
    }
});
serverApp.patch('/api/v1/tasklists', async (req, res) => {
    try {
        const {
            taskID,
            srcTasklistID,
            destTasklistID
        } = req.body;

        await dbAdapter.moveTask({
            taskID,
            srcTasklistID,
            destTasklistID
        });

        res.statusCode = 200;
        res.statusMessage = 'OK';
        res.json({ message: 'Task moved successfully' });

    } catch (err) {
        switch (err.type) {
            case DB_ERROR_TYPE_CLIENT:
                res.statusCode = 400;
                res.statusMessage = 'Bad request';
                break;
            default:
                res.statusCode = 500;
                res.statusMessage = 'Internal server error';
        }
        res.json({
            timestamp: new Date().toISOString(),
            statusCode: res.statusCode,
            message: `move task error: ${err.error.message || err.error}`
        });
    }
});*/
serverApp.listen(Number(TM_APP_PORT), TM_APP_HOST, async () => {
    try {
        await dbAdapter.connect();
    } catch (err) {
        console.log('Task Manager app is shutting down');
        process.exit(100);
    }

    console.log(`TM App Server started (${TM_APP_HOST}:${TM_APP_PORT})`);
});
process.on('SIGTERM', () => {
    console.log('SIGTERM signal received: closing HTTP DB and servers');
    serverApp.close(async () => {
        await dbAdapter.disconnect();
        console.log('HTTP and DB servers closed');
    });
});
