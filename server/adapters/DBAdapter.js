import pg from 'pg';

const DB_ERROR_TYPE_CLIENT = 'DB_ERROR_TYPE_CLIENT';
const DB_ERROR_TYPE_INTERNAL = 'DB_ERROR_TYPE_INTERNAL';

export {
    DB_ERROR_TYPE_CLIENT,
    DB_ERROR_TYPE_INTERNAL
};

export default class DBAdapter {
    #dbHost = '';
    #dbPort = -1;
    #dbName = '';
    #dbUserLogin = '';
    #dbUserPassword = '';
    #dbClient = null;

    constructor({
        dbHost,
        dbPort,
        dbName,
        dbUserLogin,
        dbUserPassword
    }) {
        this.#dbHost = dbHost;
        this.#dbPort = dbPort;
        this.#dbName = dbName;
        this.#dbUserLogin = dbUserLogin;
        this.#dbUserPassword = dbUserPassword;

        this.#dbClient = new pg.Client({
            host: this.#dbHost,
            port: this.#dbPort,
            database: this.#dbName,
            user: this.#dbUserLogin,
            password: this.#dbUserPassword
        });
    }

    async connect() {
        try {
            await this.#dbClient.connect();
            console.log('db connection established');
        } catch (err) {
            console.error(`unable to connect to db: ${err}`);
            return Promise.reject(err);
        }
    }

    async disconnect() {
        await this.#dbClient.end();
        console.log('db connection closed');
    }

    async getTasklists() {
        try {
            const tasklistsData = await this.#dbClient.query(
                'select * from tasklists order by position asc;'
            );

            return tasklistsData.rows;
        } catch (err) {
            console.error(`DB Error: unable get tasklists (${err})`);
            return Promise.reject({
                type: DB_ERROR_TYPE_INTERNAL,
                error: err
            });
        }
    }


///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
async getOrders() {
    try {
        const ordersData = await this.#dbClient.query(
            'SELECT order_id, customer_name, order_date FROM orders ORDER BY order_date;'
        );
        return ordersData.rows;
    } catch (err) {
        console.error(`DB Error: unable to get orders (${err})`);
        throw err;
    }
}

async getOrderItems(order_id) {
    try {
        const itemsData = await this.#dbClient.query(
            'SELECT * FROM order_items WHERE order_id = $1;', [order_id]
        );
        return itemsData.rows;
    } catch (err) {
        console.error(`DB Error: unable to get order items (${err})`);
        return Promise.reject({
            type: DB_ERROR_TYPE_INTERNAL,
            error: err
        });
    }
}

async getOrderItemsWithNames(order_id) {
    try {
        const result = await this.#dbClient.query(
            `SELECT oi.*, p.product_name 
             FROM order_items oi
             JOIN products p ON oi.product_id = p.product_id
             WHERE oi.order_id = $1;`,
            [order_id]
        );
        console.log('Order items with names:', result.rows);  // Логируем для проверки
        return result.rows;
    } catch (err) {
        console.error('DB Error: unable to get order items with names', err);
        throw err;
    }
}


async addOrder({ orderId, customer, date }) {
    try {
        const query = `
            INSERT INTO orders (order_id, customer_name, order_date)
            VALUES ($1, $2, $3) RETURNING *;
        `;
        const values = [orderId, customer, date];
        
        const result = await this.#dbClient.query(query, values);
        return result.rows[0];
    } catch (err) {
        console.error('DB Error: unable to add order', err);
        throw err;
    }
}

async addOrderItem({ item_id, order_id, product_id, quantity }) {
    const client = this.#dbClient;

    try {
        await client.query('BEGIN');

        // const checkStockQuery = `
        //     SELECT check_stock($1, $2, $3)
        // `;
        // await client.query(checkStockQuery, [product_id, quantity, order_id]);

        // Уменьшаем количество на складе
        await client.query(
            `UPDATE products 
             SET stock = stock - $1 
             WHERE product_id = $2;`,
            [quantity, product_id]
        );

        // Добавляем позицию в заказ
        const result = await client.query(
            `INSERT INTO order_items (item_id, order_id, product_id, quantity) 
             VALUES ($1, $2, $3, $4) RETURNING *;`,
            [item_id, order_id, product_id, quantity]
        );

        await client.query('COMMIT');
        return result.rows[0];
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(`DB Error: unable to add order item (${err})`);
        throw err;
    }
}


async deleteOrder({ order_id }) {
    try {
        await this.#dbClient.query(
            'DELETE FROM orders WHERE order_id = $1;', [order_id]
        );
    } catch (err) {
        console.error(`DB Error: unable to delete order (${err})`);
        return Promise.reject({
            type: DB_ERROR_TYPE_INTERNAL,
            error: err
        });
    }
}

async deleteOrderItem({ order_id, item_id }) {
    try {
        const result = await this.#dbClient.query(
            'DELETE FROM order_items WHERE item_id = $1 AND order_id = $2 RETURNING *;',
            [item_id, order_id]
        );

        if (result.rowCount === 0) {
            throw new Error('Order item not found');
        }
    } catch (err) {
        console.error(`DB Error: unable to delete order item (${err})`);
        throw err;
    }
}


async updateOrderItem({ item_id, quantity }) {
    const client = this.#dbClient;

    try {
        await client.query('BEGIN');

        // Получаем текущую позицию в заказе
        const item = await client.query(
            'SELECT * FROM order_items WHERE item_id = $1;',
            [item_id]
        );

        if (item.rows.length === 0) {
            throw new Error('Order item not found');
        }

        const order_id = item.rows[0].order_id;
        const product_id = item.rows[0].product_id;
        const currentQuantity = item.rows[0].quantity;

        // "Возвращаем" товар на склад для корректной проверки
        await client.query(
            `UPDATE products 
             SET stock = stock + $1 
             WHERE product_id = $2;`,
            [currentQuantity, product_id]
        );

        // Вызов функции check_stock() для проверки нового количества
        // const checkStockQuery = `
        //     SELECT check_stock($1, $2, $3)
        // `;
        await client.query(checkStockQuery, [product_id, quantity, order_id]);

        // Обновляем заказ и остатки
        await client.query(
            `UPDATE order_items 
             SET quantity = $1 
             WHERE item_id = $2;`,
            [quantity, item_id]
        );

        // Уменьшаем остаток на складе на новое количество
        await client.query(
            `UPDATE products 
             SET stock = stock - $1 
             WHERE product_id = $2;`,
            [quantity, product_id]
        );

        await client.query('COMMIT');
        return { item_id, quantity };
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('DB Error: unable to update order item', err);
        throw err;
    }
}


async moveOrderItem({ item_id, target_order_id }) {
    try {
        const item = await this.#dbClient.query(
            'SELECT * FROM order_items WHERE item_id = $1',
            [item_id]
        );

        if (item.rows.length === 0) {
            throw new Error('Order item not found');
        }

        // Обновляем заказ
        await this.#dbClient.query(
            'UPDATE order_items SET order_id = $1 WHERE item_id = $2',
            [target_order_id, item_id]
        );

    } catch (err) {
        console.error('DB Error: unable to move order item', err);
        throw err;
    }
}

async incrementDate() {
    try {
        const result = await this.#dbClient.query(`
            UPDATE cur_date
            SET current = current + INTERVAL '1 day'
            RETURNING current::date;
        `);

        // Снонис к просрочку к черту
        await this.deleteExpiredOrders();
        await this.restockProducts();

        return result.rows[0].current;
    } catch (err) {
        console.error('DB Error: unable to update date:', err);
        throw err;
    }
}

async deleteExpiredOrders() {
    try {
        const result = await this.#dbClient.query(`
            DELETE FROM orders
            WHERE order_date < (SELECT current FROM cur_date)
            RETURNING order_id;
        `);
        console.log('Удалены заказы:', result.rows);
    } catch (err) {
        console.error('DB Error: unable to delete expired orders:', err);
        throw err;
    }
}


async restockProducts() {
    try {
        await this.#dbClient.query(`
            UPDATE products
            SET stock = stock + floor(random() * 10 + 1);
        `);
        console.log('Products restocked');
    } catch (err) {
        console.error('DB Error: unable to restock products:', err);
        return Promise.reject(err);
    }
}

async updateCurDate() {
    try {
        await this.#dbClient.query(`
            UPDATE cur_date
            SET current = current + INTERVAL '1 day'
        `);
    } catch (err) {
        console.error(`DB Error: unable to update date (${err})`);
        return Promise.reject({
            type: DB_ERROR_TYPE_INTERNAL,
            error: err
        });
    }
}

async getProducts() {
    try {
        const result = await this.#dbClient.query(
            'SELECT product_id, product_name FROM products;'
        );
        return result.rows;
    } catch (err) {
        console.error('DB Error: unable to get products', err);
        throw err;
    }
}

async moveOrderItem({ item_id, target_order_id }) {
    try {
        const item = await this.#dbClient.query(
            'SELECT * FROM order_items WHERE item_id = $1',
            [item_id]
        );

        if (item.rows.length === 0) {
            throw new Error('Order item not found');
        }

        // Обновляем order_id товара
        await this.#dbClient.query(
            'UPDATE order_items SET order_id = $1 WHERE item_id = $2',
            [target_order_id, item_id]
        );

    } catch (err) {
        console.error('DB Error: unable to move order item', err);
        throw err;
    }
}

async getOrderItem({ item_id }) {
    try {
        const result = await this.#dbClient.query(
            `SELECT oi.*, p.product_name 
             FROM order_items oi
             JOIN products p ON oi.product_id = p.product_id
             WHERE oi.item_id = $1`,
            [item_id]
        );

        if (result.rows.length === 0) {
            throw new Error('Order item not found');
        }

        return result.rows[0];
    } catch (err) {
        console.error('DB Error: unable to get order item', err);
        throw err;
    }
}

async deleteOrder({ order_id }) {
    try {
        // Удаляем все товары, связанные с заказом
        await this.#dbClient.query(
            'DELETE FROM order_items WHERE order_id = $1;',
            [order_id]
        );

        // Удаляем сам заказ
        const result = await this.#dbClient.query(
            'DELETE FROM orders WHERE order_id = $1 RETURNING *;',
            [order_id]
        );

        if (result.rowCount === 0) {
            throw new Error('Order not found');
        }
    } catch (err) {
        console.error(`DB Error: unable to delete order (${err})`);
        throw err;
    }
}

async getCurrentDate() {
    try {
        const result = await this.#dbClient.query(
            `SELECT TO_CHAR(current, 'YYYY-MM-DD') AS current FROM cur_date;`
        );

        console.log('SQL результат:', result.rows);  // Лог результата SQL

        if (result.rows.length === 0 || !result.rows[0].current) {
            throw new Error('Дата не найдена в БД');
        }

        return result.rows[0].current;
    } catch (err) {
        console.error('DB Error: unable to fetch current date', err);
        throw err;
    }
}

async restockProducts() {
    try {
        await this.#dbClient.query(
            `UPDATE products 
             SET stock = stock + floor(random() * 10 + 1);`
        );
        console.log('Склад пополнен');
    } catch (err) {
        console.error('DB Error: unable to restock products', err);
        throw err;
    }
}
 
async getProductById(product_id) {
    try {
        const result = await this.#dbClient.query(
            'SELECT product_id, product_name, stock FROM products WHERE product_id = $1;',
            [product_id]
        );

        if (result.rows.length === 0) {
            throw new Error('Товар не найден');
        }

        return result.rows[0];
    } catch (err) {
        console.error('DB Error: unable to fetch product by id:', err);
        throw err;
    }
}

async restockProduct({ product_id, quantity }) {
    try {
        await this.#dbClient.query(
            `UPDATE products 
             SET stock = stock + $1 
             WHERE product_id = $2;`,
            [quantity, product_id]
        );
    } catch (err) {
        console.error('DB Error: unable to restock product:', err);
        throw err;
    }
}


}
